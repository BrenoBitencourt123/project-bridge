import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRIMARY_MODEL = "google/gemini-2.5-flash";
const FALLBACK_MODEL = "google/gemini-2.5-flash-lite";
const TIMEOUT_MS = 55_000;

async function callWithTimeout(body: object, apiKey: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const segmentList = segments.map((s: any, i: number) =>
      `${i + 1}. [${s.momentType || "concept"}] "${s.narration}"`
    ).join("\n");

    const prompt = `Para cada segmento de narração abaixo, gere um prompt de imagem (imagePrompt) e um campo de simbolismo (symbolism).

REGRAS:
- imagePrompt DEVE ser escrito em português brasileiro (PT-BR)
- Se a imagem tiver textos visíveis (rótulos, placas, fórmulas), eles DEVEM estar em PT-BR, NUNCA em inglês
- imagePrompt: descreva uma imagem literal e concreta, estilo esboço à mão em papel bege
- NÃO use metáforas abstratas — ilustre literalmente o que o narrador fala
- Se houver fórmulas matemáticas, inclua-as no prompt
- NUNCA inclua nomes de marca, canal ou logos
- Texto visível na imagem: máximo 1-4 palavras (títulos, rótulos, valores numéricos)
- symbolism: breve explicação do que a imagem representa

SEGMENTOS:
${segmentList}

Responda APENAS com JSON: {"prompts": [{"imagePrompt": "...", "symbolism": "..."}]}`;

    const messages = [{ role: "user", content: prompt }];

    // Use tool calling for structured output
    const tools = [{
      type: "function",
      function: {
        name: "return_prompts",
        description: "Return image prompts and symbolism for each segment",
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
        LOVABLE_API_KEY,
        TIMEOUT_MS,
      );
      const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
      parsed = JSON.parse(toolCall?.function?.arguments || "{}");
    } catch (primaryErr) {
      console.warn("Primary model failed, trying fallback:", primaryErr);
      const result = await callWithTimeout(
        { model: FALLBACK_MODEL, messages, tools, tool_choice: { type: "function", function: { name: "return_prompts" } } },
        LOVABLE_API_KEY,
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
