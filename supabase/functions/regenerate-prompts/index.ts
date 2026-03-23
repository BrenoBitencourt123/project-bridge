import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { segments } = await req.json();
    if (!segments?.length) throw new Error("Segments required");

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 16384, responseMimeType: "application/json" },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error [${response.status}]: ${errText}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(text);

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
