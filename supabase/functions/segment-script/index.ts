import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { script } = await req.json();
    if (!script) throw new Error("Script is required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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

ROTEIRO:
${script}

Responda APENAS com um JSON válido no formato:
{"segments": [{"narration": "...", "imagePrompt": "...", "symbolism": "...", "momentType": "...", "maxSubScenes": 1}]}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a JSON-only response bot. Always respond with valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add funds to your Lovable AI workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      throw new Error(`AI Gateway error [${response.status}]: ${errText}`);
    }

    const result = await response.json();
    const text = result.choices?.[0]?.message?.content || "{}";
    const parsed = extractAndParseJson(text);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("segment-script error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
