import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { script } = await req.json();
    if (!script) throw new Error("Script is required");

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const prompt = `Você é um segmentador de roteiros para vídeos educacionais. Divida o roteiro abaixo em BLOCOS de narração.

REGRAS:
- Cada bloco deve ter entre 30 e 90 palavras de narração
- Gere entre 40 e 60 blocos para um roteiro de 10 minutos
- O campo "narration" deve ser um trecho EXATO do roteiro original, sem modificar palavras
- O campo "imagePrompt" deve descrever uma imagem literal e concreta para ilustrar o que é narrado
- NÃO use metáforas abstratas nas imagens — ilustre literalmente o que o narrador fala
- Se houver fórmulas matemáticas na narração, inclua-as no imagePrompt
- O campo "symbolism" deve explicar brevemente o que a imagem representa
- O campo "momentType" deve ser um de: hook, concept, example, list_summary, cta
- Cada bloco deve ser um trecho coeso e contínuo do roteiro, mantendo frases completas

ROTEIRO:
${script}

Responda APENAS com um JSON válido no formato:
{"segments": [{"narration": "...", "imagePrompt": "...", "symbolism": "...", "momentType": "..."}]}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 65536,
            responseMimeType: "application/json",
          },
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
    console.error("segment-script error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
