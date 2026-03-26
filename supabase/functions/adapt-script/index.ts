import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TIMEOUT_MS = 55_000;
const PRIMARY_MODEL = "google/gemini-2.5-flash";
const FALLBACK_MODEL = "google/gemini-2.5-flash-lite";

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
  throw new Error("Não foi possível extrair JSON válido da resposta da IA");
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
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages, temperature, max_tokens: 8192 }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 429) {
        throw { status: 429, message: "Rate limit atingido. Tente novamente em alguns instantes." };
      }
      if (response.status === 402) {
        throw { status: 402, message: "Créditos de IA esgotados. Adicione créditos no painel do Lovable." };
      }
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI Gateway erro [${response.status}]: ${errText}`);
      }

      return await response.json();
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.status === 429 || e?.status === 402) throw e;
      if (i === models.length - 1) throw e;
      console.warn(`Modelo ${model} falhou, tentando fallback:`, e.message || e);
    }
  }
}

const SYSTEM_PROMPT = `Você é um roteirista profissional de vídeos educacionais para YouTube.

Você vai receber um ROTEIRO DE NARRAÇÃO BRUTO colado pelo usuário.
Sua tarefa é ADAPTAR esse roteiro para o formato padrão com blocos de cena e descrições visuais.

REGRAS CRÍTICAS:

1. MANTENHA O TEXTO ORIGINAL DA NARRAÇÃO praticamente inalterado.
   Você pode fazer apenas correções mínimas de gramática, fluidez e leitura em voz alta (TTS).
   NÃO adicione conteúdo novo. NÃO remova partes. NÃO resuma. NÃO reescreva.

2. Divida o roteiro em BLOCOS de 30 a 90 palavras cada.
   Cada bloco deve ser um trecho coeso e contínuo, com frases completas.

3. Para CADA bloco, crie uma descrição visual detalhada no campo "visual", descrevendo
   a cena ideal para ilustrar a narração. As descrições devem:
   - Ser escritas em português brasileiro
   - Ser concretas e visuais — ilustre literalmente o que é narrado
   - Focar em clareza didática: caderno, quadro, setas, gráficos, palavras-chave, tabelas, comparações
   - Transformar conceitos abstratos em imagens fáceis de entender
   - NUNCA citar marcas, logos ou nomes de canais
   - Máximo de 1 a 4 palavras visíveis na imagem (títulos ou rótulos curtos)

4. Calcule o timestamp de cada bloco sequencialmente usando: 1 palavra ≈ 0.4 segundos.

5. Aplique adaptações TTS quando necessário:
   - Números por extenso: "25%" → "vinte e cinco por cento", "R$150" → "cento e cinquenta reais"
   - Siglas foneticamente: "CDI" → "cedê i", "PIB" → "pibê"
   - Datas: "2024" → "dois mil e vinte e quatro"
   - Frações: "1/4" → "um quarto"
   - Fórmulas matemáticas lidas por extenso

FORMATO DE SAÍDA — responda APENAS com JSON válido, sem markdown, sem explicações:

{
  "video_script": [
    {
      "time": "MM:SS - MM:SS",
      "narration": "texto da narração do bloco",
      "visual": "descrição detalhada da cena visual"
    }
  ]
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { script } = await req.json();
    if (!script || !script.trim()) throw new Error("Roteiro é obrigatório");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurada");

    const userMessage = `ROTEIRO BRUTO:\n\n${script.trim()}`;

    const result = await callAIWithFallback(
      LOVABLE_API_KEY,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      0.3
    );

    const text = result.choices?.[0]?.message?.content || "{}";
    const parsed = extractAndParseJson(text) as { video_script?: any[] };

    if (!parsed.video_script || !Array.isArray(parsed.video_script)) {
      throw new Error("Resposta da IA não contém video_script válido");
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("adapt-script error:", e);
    const status = e?.status || 500;
    const message = e?.message || (e instanceof Error ? e.message : "Erro desconhecido");
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
