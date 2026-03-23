import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { freePrompt, subject, topic, difficulty, targetDuration } = await req.json();
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const duration = targetDuration || 10;
    const wordTarget = duration * 220;

    const prompt = freePrompt
      ? `${freePrompt}\n\nGere um roteiro educacional completo em português brasileiro com aproximadamente ${wordTarget} palavras (${duration} minutos de narração). O roteiro deve ser fluido, didático e voltado para estudantes do ENEM. Não inclua marcações de tempo, apenas o texto narrado.`
      : `Gere um roteiro educacional completo em português brasileiro sobre ${subject || "tema geral"}${topic ? `, focando em ${topic}` : ""}${difficulty ? ` (nível ${difficulty})` : ""}. O roteiro deve ter aproximadamente ${wordTarget} palavras (${duration} minutos de narração). Deve ser fluido, didático e voltado para estudantes do ENEM. Não inclua marcações de tempo, apenas o texto narrado.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error [${response.status}]: ${errText}`);
    }

    const result = await response.json();
    const script = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return new Response(JSON.stringify({ script }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-script error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
