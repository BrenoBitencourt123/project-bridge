import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite-preview-06-17";
const TARGET_SUB_SCENE_DURATION = 7; // segundos ideais por sub-cena

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface SegmentInput {
  id: string;
  sequence_number: number;
  narration: string;
  moment_type: string | null;
}

interface SubSceneOutput {
  narration_segment: string;
  image_prompt: string;
  start_time: number;
  end_time: number;
}

interface SegmentedOutput {
  segment_id: string;
  sub_scenes: SubSceneOutput[];
}

function buildTimestampedTranscript(words: WordTimestamp[]): string {
  // Build transcript showing a timestamp marker every ~5 words for readability
  const lines: string[] = [];
  let buffer: string[] = [];
  let lineStart = 0;

  for (let i = 0; i < words.length; i++) {
    buffer.push(words[i].word);
    if (buffer.length >= 5 || i === words.length - 1) {
      lines.push(`[${lineStart.toFixed(1)}s] ${buffer.join(" ")}`);
      buffer = [];
      if (i + 1 < words.length) lineStart = words[i + 1].start;
    }
  }
  return lines.join("\n");
}

function snapToWordTimestamp(targetTime: number, words: WordTimestamp[]): number {
  // Snap a target time to the nearest word boundary
  let best = words[0]?.start ?? 0;
  let bestDiff = Math.abs(targetTime - best);

  for (const w of words) {
    const diff = Math.abs(w.start - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = w.start;
    }
    const diffEnd = Math.abs(w.end - targetTime);
    if (diffEnd < bestDiff) {
      bestDiff = diffEnd;
      best = w.end;
    }
  }
  return best;
}

async function callGemini(apiKey: string, systemPrompt: string, userPrompt: string, model: string): Promise<string> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error [${response.status}]: ${err.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  return text;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { wordTimestamps, fullText, totalDuration, segments } = await req.json() as {
      wordTimestamps: WordTimestamp[];
      fullText: string;
      totalDuration: number;
      segments: SegmentInput[];
    };

    if (!wordTimestamps?.length || !segments?.length) {
      throw new Error("wordTimestamps and segments are required");
    }

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const timestampedTranscript = buildTimestampedTranscript(wordTimestamps);
    const estimatedSubScenes = Math.round(totalDuration / TARGET_SUB_SCENE_DURATION);

    const segmentsList = segments
      .sort((a, b) => a.sequence_number - b.sequence_number)
      .map(s => `CENA ${String(s.sequence_number).padStart(2, "0")} [${s.moment_type || "conteudo"}]: ${s.narration.slice(0, 200)}`)
      .join("\n");

    const systemPrompt = `Você é um especialista em segmentação de vídeo educacional. Sua tarefa é analisar a transcrição de um áudio (com timestamps em segundos) e dividir em sub-cenas visuais de ~${TARGET_SUB_SCENE_DURATION} segundos cada.

REGRAS:
- Cada sub-cena deve representar um MOMENTO VISUAL ÚNICO e completo (uma ideia, uma virada, um exemplo)
- Corte preferencialmente em pausas naturais da fala, nunca no meio de uma palavra ou frase
- Duração ideal: 6–10 segundos. Mínimo absoluto: 5s. Máximo: 15s
- Respeite a estrutura de cenas existente — mantenha sub-cenas dentro da cena correta
- O image_prompt deve descrever EM PORTUGUÊS o que aparece na imagem (sem estilo, sem ângulo, apenas conteúdo visual): sujeito, ação, objetos, contexto espacial. 2-3 frases diretas
- NUNCA repita o mesmo elemento visual central em sub-cenas consecutivas da mesma cena
- Total estimado de sub-cenas: ~${estimatedSubScenes}

RETORNE um JSON válido com esta estrutura exata:
{
  "segments": [
    {
      "segment_id": "<id da cena>",
      "sub_scenes": [
        {
          "narration_segment": "<texto exato falado nesta sub-cena>",
          "image_prompt": "<descrição visual em PT-BR>",
          "start_time": <número em segundos>,
          "end_time": <número em segundos>
        }
      ]
    }
  ]
}`;

    const userPrompt = `TRANSCRIÇÃO COM TIMESTAMPS:
${timestampedTranscript}

DURAÇÃO TOTAL: ${totalDuration.toFixed(1)}s

ESTRUTURA DE CENAS DO VÍDEO:
${segmentsList}

Divida o áudio em sub-cenas de ~${TARGET_SUB_SCENE_DURATION}s, respeitando as cenas acima. Use os IDs exatos das cenas.

IDs das cenas (para usar no segment_id):
${segments.sort((a, b) => a.sequence_number - b.sequence_number).map(s => `CENA ${String(s.sequence_number).padStart(2, "0")}: "${s.id}"`).join("\n")}`;

    let rawJson: string;
    try {
      rawJson = await callGemini(GOOGLE_AI_API_KEY, systemPrompt, userPrompt, PRIMARY_MODEL);
    } catch (e) {
      console.warn(`Primary model failed, trying fallback:`, e);
      rawJson = await callGemini(GOOGLE_AI_API_KEY, systemPrompt, userPrompt, FALLBACK_MODEL);
    }

    // Parse and validate
    let parsed: { segments: { segment_id: string; sub_scenes: SubSceneOutput[] }[] };
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      // Try to extract JSON from markdown code block
      const match = rawJson.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        parsed = JSON.parse(match[1]);
      } else {
        throw new Error(`Invalid JSON from Gemini: ${rawJson.slice(0, 200)}`);
      }
    }

    // Snap timestamps to actual word boundaries for precision
    const result: SegmentedOutput[] = parsed.segments.map(seg => ({
      segment_id: seg.segment_id,
      sub_scenes: seg.sub_scenes.map((sc, i) => {
        const start = snapToWordTimestamp(sc.start_time, wordTimestamps);
        const end = i < seg.sub_scenes.length - 1
          ? snapToWordTimestamp(sc.end_time, wordTimestamps)
          : sc.end_time; // last sub-scene of segment keeps original end
        return {
          narration_segment: sc.narration_segment,
          image_prompt: sc.image_prompt,
          start_time: Math.max(0, start),
          end_time: Math.min(totalDuration, end),
        };
      }),
    }));

    return new Response(JSON.stringify({ segmentedSubScenes: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("segment-audio error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
