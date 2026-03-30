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

/** Remove markdown formatting artifacts that hurt TTS and image prompt generation */
function cleanScriptForNarration(text: string): string {
  return text
    // Remove markdown headers (### Title → Title)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold markers (**text** → text)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    // Remove italic markers (*text* → text)
    .replace(/\*([^*]+)\*/g, '$1')
    // Remove markdown bullet points (- item → item, * item → item)
    .replace(/^[\s]*[-*]\s+/gm, '')
    // Remove numbered list prefixes (1. item → item)
    .replace(/^\s*\d+\.\s+/gm, '')
    // Remove inline code backticks
    .replace(/`([^`]+)`/g, '$1')
    // Remove blockquote markers
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^---+$/gm, '')
    // Collapse multiple blank lines into one
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { freePrompt, subject, topic, difficulty, targetDuration } = await req.json();
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const duration = targetDuration || 10;
    const wordTarget = duration * 220;

    const systemPrompt = `Você é um roteirista profissional de vídeos educacionais para YouTube.

REGRAS OBRIGATÓRIAS DE FORMATO:
- Escreva APENAS texto corrido de narração, como se fosse lido em voz alta por um narrador.
- NUNCA use formatação Markdown: nada de **, *, ###, listas numeradas (1. 2. 3.), bullets (- ou *), backticks, blockquotes (>), ou qualquer marcação.
- NUNCA use cabeçalhos ou títulos dentro do texto. Use transições naturais de fala ("Agora vamos falar sobre...", "O próximo ponto é...").
- Parágrafos devem ser separados por uma linha em branco, nada mais.

REGRAS DE FORMATAÇÃO TTS (para narração por voz):
- Escreva números por extenso: "1000" → "mil", "25%" → "vinte e cinco por cento", "R$150" → "cento e cinquenta reais".
- Siglas conhecidas devem ser escritas foneticamente: "CDI" → "cedê i", "SELIC" → "selic", "PIB" → "pibê", "ENEM" → "enem", "ONU" → "ônu".
- Datas por extenso: "2026" → "dois mil e vinte e seis".
- Frações por extenso: "1/4" → "um quarto", "3/5" → "três quintos".
- Fórmulas matemáticas devem ser lidas por extenso: "P(A) = 3/6" → "a probabilidade de A é igual a três sextos".
- Use reticências (...) para pausas dramáticas e vírgulas para pausas curtas.

REGRAS DE CONTEÚDO:
- O roteiro deve ser envolvente, didático e com tom conversacional, como se estivesse falando diretamente com o aluno.
- Inclua um gancho forte no início (hook) para prender a atenção nos primeiros segundos.
- Use exemplos concretos e situações do cotidiano para explicar conceitos.
- Inclua UMA ÚNICA chamada para ação (CTA) curta — "deixa o like e se inscreve" — em um ponto natural do roteiro (geralmente após o gancho ou antes de um tópico importante). NÃO repita CTAs no final.
- Feche com uma mensagem motivacional ou resumo curto, sem repetir CTA.

REGRAS PARA OTIMIZAÇÃO VISUAL (segmentação e imagens):
- Descreva cenários, situações e exemplos de forma visual e concreta — isso facilita a geração de imagens ilustrativas depois.
- Evite longas sequências abstratas sem exemplos visuais. Alterne entre conceito e ilustração.
- Quando mencionar objetos, cenários ou personagens, seja específico: "uma urna com cinco bolinhas, três vermelhas e duas azuis" é melhor que "uma urna com bolinhas".`;

    const userPrompt = freePrompt
      ? `${freePrompt}\n\nGere um roteiro educacional completo em português brasileiro com aproximadamente ${wordTarget} palavras (${duration} minutos de narração).`
      : `Gere um roteiro educacional completo em português brasileiro sobre ${subject || "tema geral"}${topic ? `, focando em ${topic}` : ""}${difficulty ? ` (nível ${difficulty})` : ""}. O roteiro deve ter aproximadamente ${wordTarget} palavras (${duration} minutos de narração).`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    let result: any;
    try {
      result = await callWithTimeout(
        { model: PRIMARY_MODEL, messages, temperature: 0.7, max_tokens: 8192 },
        GOOGLE_AI_API_KEY,
        TIMEOUT_MS,
      );
    } catch (primaryErr) {
      console.warn("Primary model failed, trying fallback:", primaryErr);
      result = await callWithTimeout(
        { model: FALLBACK_MODEL, messages, temperature: 0.7, max_tokens: 8192 },
        GOOGLE_AI_API_KEY,
        TIMEOUT_MS,
      );
    }

    const rawScript = result.choices?.[0]?.message?.content || "";
    // Safety: clean any markdown that slipped through despite instructions
    const script = cleanScriptForNarration(rawScript);

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
