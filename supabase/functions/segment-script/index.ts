import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TIMEOUT_MS = 55_000;
const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";

function repairJson(json: string): string {
  let braces = 0, brackets = 0;
  for (const c of json) {
    if (c === '{') braces++;
    if (c === '}') braces--;
    if (c === '[') brackets++;
    if (c === ']') brackets--;
  }
  let r = json;
  while (brackets > 0) { r += ']'; brackets--; }
  while (braces > 0) { r += '}'; braces--; }
  return r
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, "");
}

function extractAndParseJson(content: string): unknown {
  try { return JSON.parse(content); } catch { /* continue */ }
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch { /* continue */ }
  }
  const jsonMatch = content.match(/\{[\s\S]*"[^"]+"\s*:[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* continue */ }
    try { return JSON.parse(repairJson(jsonMatch[0])); } catch { /* continue */ }
  }
  try { return JSON.parse(repairJson(content)); } catch { /* continue */ }
  throw new Error("Could not extract valid JSON from AI response");
}

async function callAIWithFallback(
  apiKey: string,
  messages: { role: string; content: string }[],
  temperature: number
): Promise<any> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      console.log(`Trying model: ${model}`);
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages, temperature }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 429) {
        throw { status: 429, message: "Rate limit exceeded. Please try again later." };
      }
      if (response.status === 402) {
        throw { status: 402, message: "Payment required. Please add funds to your Lovable AI workspace." };
      }
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI Gateway error [${response.status}]: ${errText}`);
      }

      return await response.json();
    } catch (e: any) {
      clearTimeout(timer);
      // If rate limit or payment error, propagate immediately
      if (e?.status === 429 || e?.status === 402) throw e;
      // If last model, propagate error
      if (i === models.length - 1) throw e;
      console.warn(`Model ${model} failed, trying fallback:`, e.message || e);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { script } = await req.json();
    if (!script) throw new Error("Script is required");

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const prompt = `Você é um segmentador de roteiros para vídeos educacionais. Divida o roteiro abaixo em BLOCOS de narração.

REGRAS:
- Cada bloco deve ter entre 60 e 150 palavras de narração
- Gere entre 8 e 15 blocos para um roteiro de ~8 minutos (ajuste proporcionalmente)
- O campo "narration" deve ser um trecho EXATO do roteiro original, sem modificar palavras
- O campo "imagePrompt" DEVE ser escrito em português brasileiro (PT-BR)
- Se a imagem tiver textos visíveis (rótulos, placas, fórmulas), eles DEVEM estar em PT-BR, NUNCA em inglês
- O imagePrompt deve descrever uma imagem literal e concreta para ilustrar o que é narrado
- NÃO use metáforas abstratas nas imagens — ilustre literalmente o que o narrador fala
- Se houver fórmulas matemáticas na narração, inclua-as no imagePrompt
- NUNCA inclua nomes de marca, canal ou logos no imagePrompt
- Texto visível na imagem: máximo 1-4 palavras (títulos, rótulos, valores numéricos)
- O campo "symbolism" deve explicar brevemente o que a imagem representa
- O campo "momentType" deve ser um de: hook, concept, example, list_summary, cta
- Cada bloco deve ser um trecho coeso e contínuo do roteiro, mantendo frases completas
- IMPORTANTE: Prefira MENOS blocos com MAIS texto cada, para reduzir o número total de imagens

REGRAS ESPECIAIS POR TIPO DE MOMENTO:
- Blocos "cta" (chamada para ação como "curtir", "se inscrever", "comentar") devem ser UM ÚNICO bloco curto. O imagePrompt deve ser genérico como "ícones de curtir, se inscrever e compartilhar em uma interface de vídeo". NÃO fragmente CTAs em múltiplos blocos.
- Blocos "hook" (abertura/gancho) devem ser concisos — 1 bloco apenas.
- O campo "maxSubScenes" indica quantas sub-imagens este bloco precisa:
  - Para "cta": sempre 1
  - Para "hook": sempre 1
  - Para outros tipos: entre 1 e 4, baseado na complexidade visual do conteúdo

FORMATAÇÃO TTS (IMPORTANTE para narração por voz):
- Escreva números por extenso na narração: "1000" → "mil", "25%" → "vinte e cinco por cento", "R$150" → "cento e cinquenta reais"
- Siglas devem ser escritas foneticamente: "CDI" → "cedê i", "SELIC" → "selic", "PIB" → "pibê", "ENEM" → "enem"
- Datas: "2026" → "dois mil e vinte e seis"
- Frações: "1/4" → "um quarto", "3/5" → "três quintos"
- NÃO altere o significado, apenas adapte a forma escrita para leitura em voz alta

ROTEIRO:
${script}

Responda APENAS com um JSON válido no formato:
{"segments": [{"narration": "...", "imagePrompt": "...", "symbolism": "...", "momentType": "...", "maxSubScenes": 1}]}`;

    const result = await callAIWithFallback(
      GOOGLE_AI_API_KEY,
      [
        { role: "system", content: "You are a JSON-only response bot. Always respond with valid JSON." },
        { role: "user", content: prompt },
      ],
      0.3
    );

    const text = result.choices?.[0]?.message?.content || "{}";
    const parsed = extractAndParseJson(text);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("segment-script error:", e);
    const status = e?.status || 500;
    const message = e?.message || (e instanceof Error ? e.message : "Unknown error");
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
