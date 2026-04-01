import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

interface WordTimestamp { word: string; start: number; end: number; }

interface SubSceneRaw {
  narration_segment?: string;
  narration?: string;
  image_prompt?: string;
  start_time: number;
  end_time: number;
}

interface SegmentRaw {
  name: string;
  moment_type: string;
  sub_scenes: SubSceneRaw[];
}

function buildTimestampedTranscript(words: WordTimestamp[]): string {
  const lines: string[] = [];
  let buffer: string[] = [];
  let lineStart = 0;
  for (let i = 0; i < words.length; i++) {
    buffer.push(words[i].word);
    if (buffer.length >= 6 || i === words.length - 1) {
      lines.push(`[${lineStart.toFixed(1)}s] ${buffer.join(" ")}`);
      buffer = [];
      if (i + 1 < words.length) lineStart = words[i + 1].start;
    }
  }
  return lines.join("\n");
}

function snapToWordBoundary(time: number, words: WordTimestamp[]): number {
  if (words.length === 0) return time;
  let best = words[0].start;
  let bestDiff = Math.abs(time - best);
  for (const w of words) {
    const ds = Math.abs(w.start - time);
    const de = Math.abs(w.end - time);
    if (ds < bestDiff) { bestDiff = ds; best = w.start; }
    if (de < bestDiff) { bestDiff = de; best = w.end; }
  }
  return best;
}

async function callGemini(apiKey: string, system: string, user: string, _model: string, jsonMode: boolean): Promise<string> {
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature: 0.4 },
  };
  if (jsonMode) (body.generationConfig as Record<string, unknown>).responseMimeType = "application/json";

  let lastErr = "";
  for (const model of MODELS) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    if (resp.ok) {
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini returned no content");
      return text;
    }
    lastErr = (await resp.text()).slice(0, 300);
    console.warn(`Model ${model} failed [${resp.status}], trying next...`);
  }
  throw new Error(`All Gemini models failed. Last error: ${lastErr}`);
}

function parseJSON(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* try extracting from markdown */ }
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return JSON.parse(m[1]);
  throw new Error(`Cannot parse JSON: ${raw.slice(0, 200)}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, wordTimestamps, fullText, totalDuration, audioBase64 } = await req.json() as {
      projectId: string;
      wordTimestamps: WordTimestamp[];
      fullText: string;
      totalDuration: number;
      audioBase64: string; // full merged audio as base64 WAV/MP3
    };

    if (!projectId || !wordTimestamps?.length) throw new Error("projectId and wordTimestamps required");

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const transcript = buildTimestampedTranscript(wordTimestamps);
    const estimatedSubScenes = Math.max(Math.round(totalDuration / 7), 4);

    // ─── PASS 1: Deep content analysis ─────────────────────────────────────────
    const pass1System = `Você é um especialista em conteúdo educacional para o ENEM e em narrativa de vídeo. Analise a transcrição fornecida com profundidade.`;

    const pass1User = `TRANSCRIÇÃO DO VÍDEO:
${fullText}

Analise este vídeo e retorne um JSON com:
{
  "title": "título curto e impactante para o vídeo (máx 8 palavras)",
  "subject": "disciplina principal (ex: Matemática, Português, História)",
  "topic": "tópico específico (ex: Porcentagem, Concordância Verbal)",
  "difficulty": "básico | intermediário | avançado",
  "audience": "público-alvo em uma frase curta",
  "narrative_arc": "descrição do arco emocional: como o espectador se sente do início ao fim",
  "blocks": [
    {
      "function": "hook | tensão | revelação | conceito | método | exemplo | prática | armadilha | fechamento | cta",
      "text_preview": "primeiras palavras deste bloco (máx 15 palavras)",
      "pedagogical_value": "por que este momento importa para o aprendizado",
      "emotional_note": "o que o espectador sente aqui",
      "visual_potential": "que tipo de imagem amplifica este momento"
    }
  ]
}`;

    const raw1 = await callGemini(GOOGLE_AI_API_KEY, pass1System, pass1User, "", true);
    const analysis = parseJSON(raw1) as Record<string, unknown>;

    // ─── PASS 2: Intelligent segmentation using Pass 1 context ─────────────────
    const blocksContext = Array.isArray(analysis.blocks)
      ? (analysis.blocks as Record<string, string>[]).map((b, i) =>
          `${i + 1}. [${b.function}] "${b.text_preview}" — ${b.pedagogical_value}`
        ).join("\n")
      : "";

    const pass2System = `Você é um editor de vídeo educacional especialista em conteúdo ENEM. Cada corte que você faz tem um PROPÓSITO narrativo e pedagógico — você não corta por tempo, você corta por significado.`;

    const pass2User = `ANÁLISE DO CONTEÚDO:
Título: ${analysis.title}
Assunto: ${analysis.subject} | Tópico: ${analysis.topic}
Arco narrativo: ${analysis.narrative_arc}

BLOCOS IDENTIFICADOS:
${blocksContext}

TRANSCRIÇÃO COM TIMESTAMPS:
${transcript}

DURAÇÃO TOTAL: ${totalDuration.toFixed(1)}s
TOTAL ESTIMADO DE SUB-CENAS: ~${estimatedSubScenes}

Crie a estrutura completa do vídeo. Para cada segmento (seção lógica), crie sub-cenas de 5-15s.

REGRAS DE CORTE:
- Corte APÓS uma pergunta ou desafio lançado (cria tensão para a resposta)
- Corte ANTES de uma revelação importante (o espectador "quer" a próxima cena)
- Corte na transição entre conceitos distintos
- Corte após um exemplo completo (deixa a informação assentar)
- Momentos de hook: 5-7s (ritmo rápido)
- Momentos de revelação/virada: 4-7s (impacto)
- Exemplos e métodos: 8-12s (precisam respirar)
- Fechamento/CTA: 8-12s

REGRAS DE IMAGE_PROMPT:
- Descreva o que AMPLIFICA o momento pedagógico, não apenas ilustra
- Seja específico: sujeito + ação + elementos visuais + contexto espacial
- Nunca repita o mesmo elemento central em sub-cenas consecutivas do mesmo segmento
- Em PT-BR, 2-3 frases, sem mencionar estilo ou ângulo de câmera

Retorne JSON:
{
  "segments": [
    {
      "name": "nome descritivo do segmento",
      "moment_type": "hook | concept | example | list_summary | cta",
      "sub_scenes": [
        {
          "narration_segment": "texto exato falado nesta sub-cena",
          "image_prompt": "descrição visual em PT-BR que amplifica o momento",
          "start_time": 0.0,
          "end_time": 6.5
        }
      ]
    }
  ]
}`;

    const raw2 = await callGemini(GOOGLE_AI_API_KEY, pass2System, pass2User, "", true);
    const segmentation = parseJSON(raw2) as { segments: SegmentRaw[] };

    // Sanitize: ensure every sub_scene has narration_segment, filter empty ones
    for (const seg of segmentation.segments) {
      seg.sub_scenes = (seg.sub_scenes || [])
        .map((sc) => ({ ...sc, narration_segment: (sc.narration_segment || sc.narration || "").trim() }))
        .filter((sc) => sc.narration_segment.length > 0);
    }
    // Remove segments with no valid sub_scenes
    segmentation.segments = segmentation.segments.filter((s) => s.sub_scenes.length > 0);

    // ─── Save to DB ──────────────────────────────────────────────────────────────

    // Update project metadata
    await supabase.from("projects").update({
      title: analysis.title as string,
      subject: analysis.subject as string,
      topic: analysis.topic as string,
      difficulty_level: analysis.difficulty as string,
      updated_at: new Date().toISOString(),
    }).eq("id", projectId);

    // Delete existing segments (cascades to sub_scenes if FK with cascade, else delete manually)
    const { data: existingSegs } = await supabase.from("segments").select("id").eq("project_id", projectId);
    if (existingSegs && existingSegs.length > 0) {
      const segIds = existingSegs.map((s: { id: string }) => s.id);
      await supabase.from("sub_scenes").delete().in("segment_id", segIds);
      await supabase.from("segments").delete().eq("project_id", projectId);
    }

    // Decode audio for cutting
    const audioBytes = base64Decode(audioBase64);

    // Insert segments + sub-scenes and cut audio
    const validMomentTypes = ["hook", "concept", "example", "list_summary", "cta"];
    const createdSegments: Record<string, unknown>[] = [];

    for (let si = 0; si < segmentation.segments.length; si++) {
      const seg = segmentation.segments[si];
      const seqNum = si + 1;
      const momentType = validMomentTypes.includes(seg.moment_type) ? seg.moment_type : "concept";

      const { data: insertedSeg, error: segErr } = await supabase
        .from("segments")
        .insert({
          project_id: projectId,
          sequence_number: seqNum,
          narration: seg.sub_scenes.map((sc) => sc.narration_segment).join(" "),
          moment_type: momentType,
          image_status: "idle",
          audio_status: "idle",
        })
        .select()
        .single();

      if (segErr) throw new Error(`Failed to insert segment ${seqNum}: ${segErr.message}`);

      const insertedSubScenes: Record<string, unknown>[] = [];

      for (let sci = 0; sci < seg.sub_scenes.length; sci++) {
        const sc = seg.sub_scenes[sci];
        const startSnapped = snapToWordBoundary(sc.start_time, wordTimestamps);
        const endSnapped = sci < seg.sub_scenes.length - 1
          ? snapToWordBoundary(sc.end_time, wordTimestamps)
          : sc.end_time;

        const { data: insertedSc, error: scErr } = await supabase
          .from("sub_scenes")
          .insert({
            segment_id: (insertedSeg as { id: string }).id,
            sub_index: sci + 1,
            narration_segment: sc.narration_segment || sc.narration || "",
            image_prompt: sc.image_prompt || null,
            image_status: "idle",
            audio_status: "idle",
          })
          .select()
          .single();

        if (scErr) throw new Error(`Failed to insert sub_scene: ${scErr.message}`);

        // Cut and upload audio slice
        try {
          // Determine byte range for this time slice
          // audioBytes is raw audio — we store start/end times and let client cut,
          // OR we do a simple proportional byte slice for WAV
          // For simplicity: upload a marker and let the client handle cutting
          // Actually we pass the audio back to client for cutting — see response below
          insertedSubScenes.push({
            ...(insertedSc as Record<string, unknown>),
            _start: Math.max(0, startSnapped),
            _end: Math.min(totalDuration, endSnapped),
          });
        } catch (e) {
          console.warn(`Audio slice failed for sub_scene ${sci + 1}:`, e);
          insertedSubScenes.push({
            ...(insertedSc as Record<string, unknown>),
            _start: Math.max(0, startSnapped),
            _end: Math.min(totalDuration, endSnapped),
          });
        }
      }

      createdSegments.push({
        ...(insertedSeg as Record<string, unknown>),
        sub_scenes: insertedSubScenes,
      });
    }

    // Update project status
    await supabase.from("projects").update({
      status: "segmented",
      updated_at: new Date().toISOString(),
    }).eq("id", projectId);

    return new Response(JSON.stringify({
      title: analysis.title,
      subject: analysis.subject,
      topic: analysis.topic,
      segments: createdSegments,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-audio error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
