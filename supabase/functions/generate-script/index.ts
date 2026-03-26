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
    const { freePrompt, subject, topic, difficulty, targetDuration } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const duration = targetDuration || 10;
    const wordTarget = duration * 220;

    const prompt = freePrompt
      ? `${freePrompt}\n\nGere um roteiro educacional completo em português brasileiro com aproximadamente ${wordTarget} palavras (${duration} minutos de narração). O roteiro deve ser fluido, didático e voltado para estudantes do ENEM. Não inclua marcações de tempo, apenas o texto narrado.`
      : `Gere um roteiro educacional completo em português brasileiro sobre ${subject || "tema geral"}${topic ? `, focando em ${topic}` : ""}${difficulty ? ` (nível ${difficulty})` : ""}. O roteiro deve ter aproximadamente ${wordTarget} palavras (${duration} minutos de narração). Deve ser fluido, didático e voltado para estudantes do ENEM. Não inclua marcações de tempo, apenas o texto narrado.`;

    const messages = [{ role: "user", content: prompt }];

    let result: any;
    try {
      result = await callWithTimeout(
        { model: PRIMARY_MODEL, messages, temperature: 0.7, max_tokens: 8192 },
        LOVABLE_API_KEY,
        TIMEOUT_MS,
      );
    } catch (primaryErr) {
      console.warn("Primary model failed, trying fallback:", primaryErr);
      result = await callWithTimeout(
        { model: FALLBACK_MODEL, messages, temperature: 0.7, max_tokens: 8192 },
        LOVABLE_API_KEY,
        TIMEOUT_MS,
      );
    }

    const script = result.choices?.[0]?.message?.content || "";

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
