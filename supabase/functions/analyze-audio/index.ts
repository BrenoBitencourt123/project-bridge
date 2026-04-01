import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite-preview-06-17";

interface Phrase { text: string; start: number; end: number; }

interface Transcription {
  full_text: string;
  duration: number;
  phrases: Phrase[];
}

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildTimestampedTranscript(phrases: Phrase[]): string {
  return phrases.map(p => `[${p.start.toFixed(1)}s] ${p.text}`).join("\n");
}

function snapToPhraseBoundary(time: number, phrases: Phrase[]): number {
  if (phrases.length === 0) return time;
  let best = phrases[0].start;
  let bestDiff = Math.abs(time - best);
  for (const p of phrases) {
    const ds = Math.abs(p.start - time);
    const de = Math.abs(p.end - time);
    if (ds < bestDiff) { bestDiff = ds; best = p.start; }
    if (de < bestDiff) { bestDiff = de; best = p.end; }
  }
  return best;
}

async function callGemini(
  apiKey: string,
  system: string,
  user: string,
  model: string,
  jsonMode: boolean,
  audioPart?: { mimeType: string; data: string },
): Promise<string> {
  const userParts: Record<string, unknown>[] = [];
  if (audioPart) {
    userParts.push({ inlineData: { mimeType: audioPart.mimeType, data: audioPart.data } });
  }
  userParts.push({ text: user });

  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: userParts }],
    generationConfig: { temperature: 0.3 },
  };
  if (jsonMode) (body.generationConfig as Record<string, unknown>).responseMimeType = "application/json";

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!resp.ok) throw new Error(`Gemini [${resp.status}]: ${(await resp.text()).slice(0, 400)}`);
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  return text;
}

function parseJSON(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* try extracting from markdown */ }
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return JSON.parse(m[1]);
  throw new Error(`Cannot parse JSON: ${raw.slice(0, 200)}`);
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, audioBase64, mimeType } = await req.json() as {
      projectId: string;
      audioBase64: string;
      mimeType: string;
    };

    if (!projectId || !audioBase64) throw new Error("projectId and audioBase64 required");

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Normalise mime type
    const audioMime = (mimeType && mimeType.startsWith("audio/")) ? mimeType : "audio/mp3";
    const audioPart = { mimeType: audioMime, data: audioBase64 };

    // ─── PASS 0: Transcription with phrase-level timestamps ──────────────────
    const pass0System = `Você é um transcritor preciso de áudio em português brasileiro.`;
    const pass0User = `Transcreva este áudio e retorne APENAS um JSON válido com a seguinte estrutura:
{
  "full_text": "transcrição completa do áudio",
  "duration": 120.5,
  "phrases": [
    { "text": "frase falada", "start": 0.0, "end": 4.5 },
    { "text": "próxima frase", "start": 4.5, "end": 9.2 }
  ]
}

REGRAS:
- Cada "phrase" deve ter 1-3 frases curtas agrupadas logicamente
- "start" e "end" são timestamps em segundos (float)
- "duration" é a duração total do áudio em segundos
- Não inclua nada além do JSON`;

    let transcription: Transcription;
    try {
      const raw0 = await callGemini(GOOGLE_AI_API_KEY, pass0System, pass0User, PRIMARY_MODEL, true, audioPart);
      transcription = parseJSON(raw0) as Transcription;
    } catch {
      const raw0 = await callGemini(GOOGLE_AI_API_KEY, pass0System, pass0User, FALLBACK_MODEL, true, audioPart);
      transcription = parseJSON(raw0) as Transcription;
    }

    const { full_text: fullText, duration: totalDuration, phrases } = transcription;
    if (!phrases?.length) throw new Error("Gemini não retornou phrases na transcrição");

    const estimatedSubScenes = Math.max(Math.round(totalDuration / 7), 4);

    // ─── PASS 1: Deep content analysis ──────────────────────────────────────
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

    let analysis: Record<string, unknown>;
    try {
      const raw1 = await callGemini(GOOGLE_AI_API_KEY, pass1System, pass1User, PRIMARY_MODEL, true);
      analysis = parseJSON(raw1) as Record<string, unknown>;
    } catch {
      const raw1 = await callGemini(GOOGLE_AI_API_KEY, pass1System, pass1User, FALLBACK_MODEL, true);
      analysis = parseJSON(raw1) as Record<string, unknown>;
    }

    // ─── PASS 2: Intelligent segmentation using Pass 1 context ──────────────
    const blocksContext = Array.isArray(analysis.blocks)
      ? (analysis.blocks as Record<string, string>[]).map((b, i) =>
          `${i + 1}. [${b.function}] "${b.text_preview}" — ${b.pedagogical_value}`
        ).join("\n")
      : "";

    const transcript = buildTimestampedTranscript(phrases);

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

    let segmentation: { segments: SegmentRaw[] };
    try {
      const raw2 = await callGemini(GOOGLE_AI_API_KEY, pass2System, pass2User, PRIMARY_MODEL, true);
      segmentation = parseJSON(raw2) as { segments: SegmentRaw[] };
    } catch {
      const raw2 = await callGemini(GOOGLE_AI_API_KEY, pass2System, pass2User, FALLBACK_MODEL, true);
      segmentation = parseJSON(raw2) as { segments: SegmentRaw[] };
    }

    // ─── Save to DB ──────────────────────────────────────────────────────────

    await supabase.from("projects").update({
      title: analysis.title as string,
      subject: analysis.subject as string,
      topic: analysis.topic as string,
      difficulty_level: analysis.difficulty as string,
      updated_at: new Date().toISOString(),
    }).eq("id", projectId);

    // Delete existing segments + sub_scenes
    const { data: existingSegs } = await supabase.from("segments").select("id").eq("project_id", projectId);
    if (existingSegs && existingSegs.length > 0) {
      const segIds = existingSegs.map((s: { id: string }) => s.id);
      await supabase.from("sub_scenes").delete().in("segment_id", segIds);
      await supabase.from("segments").delete().eq("project_id", projectId);
    }

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
          narration: seg.sub_scenes.map((sc) => sc.narration_segment || sc.narration || "").join(" "),
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
        const startSnapped = snapToPhraseBoundary(sc.start_time, phrases);
        const endSnapped = sci < seg.sub_scenes.length - 1
          ? snapToPhraseBoundary(sc.end_time, phrases)
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

        insertedSubScenes.push({
          ...(insertedSc as Record<string, unknown>),
          _start: Math.max(0, startSnapped),
          _end: Math.min(totalDuration, endSnapped),
        });
      }

      createdSegments.push({
        ...(insertedSeg as Record<string, unknown>),
        sub_scenes: insertedSubScenes,
      });
    }

    await supabase.from("projects").update({
      status: "segmented",
      updated_at: new Date().toISOString(),
    }).eq("id", projectId);

    return new Response(JSON.stringify({
      title: analysis.title,
      subject: analysis.subject,
      topic: analysis.topic,
      totalDuration,
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
