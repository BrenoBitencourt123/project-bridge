import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";
const TIMEOUT_MS = 55_000;

async function callWithTimeout(body: object, apiKey: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) throw new Error("Rate limited — please try again in a moment");
      if (response.status === 402) throw new Error("AI credits exhausted — please add funds in Settings > Workspace > Usage");
      throw new Error(`AI Gateway error [${response.status}]: ${errText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { segments } = await req.json();
    if (!segments?.length) throw new Error("Segments required");

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    // Build a flat list of sub-scenes with their context
    const subSceneList: string[] = [];
    let flatIdx = 0;
    for (const seg of segments) {
      const subScenes = seg.subScenes || [];
      if (subScenes.length === 0) {
        // No sub-scenes: treat the segment narration as a single item
        flatIdx++;
        subSceneList.push(
          `${flatIdx}. [Bloco ${seg.sequenceNumber || '?'}, tipo: ${seg.momentType || 'concept'}] "${seg.narration}"`
        );
      } else {
        for (const sc of subScenes) {
          flatIdx++;
          subSceneList.push(
            `${flatIdx}. [Bloco ${seg.sequenceNumber || '?'}, sub-cena ${sc.subIndex}, tipo: ${seg.momentType || 'concept'}] "${sc.narration}"`
          );
        }
      }
    }

    const prompt = `Você é um diretor de arte para vídeos educacionais ilustrados no estilo sketch (esboço a lápis em papel bege com destaque em azul).

Para CADA sub-cena abaixo, gere um prompt de imagem (imagePrompt) ÚNICO e ESPECÍFICO para o conteúdo da narração.

REGRAS OBRIGATÓRIAS:
- imagePrompt DEVE ser em português brasileiro (PT-BR)
- Descreva uma cena LITERAL e CONCRETA que ilustre ESPECIFICAMENTE o que a narração diz
- CADA sub-cena deve ter uma composição visual DIFERENTE — não repita elementos centrais
- Se a narração fala de um conceito abstrato, use uma METÁFORA VISUAL concreta
- Se houver fórmulas/números, inclua-os no prompt
- Textos visíveis na imagem: máximo 1-4 palavras (rótulos, valores)
- NUNCA inclua nomes de marca, canal ou logos
- symbolism: breve explicação do que a imagem representa

SUB-CENAS:
${subSceneList.join('\n')}

Responda com JSON: {"prompts": [{"imagePrompt": "...", "symbolism": "..."}]}
Total esperado: ${flatIdx} prompts (um por sub-cena).`;

    const messages = [{ role: "user", content: prompt }];

    const tools = [{
      type: "function",
      function: {
        name: "return_prompts",
        description: "Return image prompts and symbolism for each sub-scene",
        parameters: {
          type: "object",
          properties: {
            prompts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  imagePrompt: { type: "string" },
                  symbolism: { type: "string" },
                },
                required: ["imagePrompt", "symbolism"],
                additionalProperties: false,
              },
            },
          },
          required: ["prompts"],
          additionalProperties: false,
        },
      },
    }];

    let parsed: any;
    try {
      const result = await callWithTimeout(
        { model: PRIMARY_MODEL, messages, tools, tool_choice: { type: "function", function: { name: "return_prompts" } } },
        GOOGLE_AI_API_KEY,
        TIMEOUT_MS,
      );
      const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
      parsed = JSON.parse(toolCall?.function?.arguments || "{}");
    } catch (primaryErr) {
      console.warn("Primary model failed, trying fallback:", primaryErr);
      const result = await callWithTimeout(
        { model: FALLBACK_MODEL, messages, tools, tool_choice: { type: "function", function: { name: "return_prompts" } } },
        GOOGLE_AI_API_KEY,
        TIMEOUT_MS,
      );
      const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
      parsed = JSON.parse(toolCall?.function?.arguments || "{}");
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("regenerate-prompts error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
