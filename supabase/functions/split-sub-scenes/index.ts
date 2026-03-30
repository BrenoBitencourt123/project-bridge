import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TIMEOUT_MS = 55_000;
const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";

interface SubSceneOutput {
  narration_segment: string;
  image_prompt: string;
}

// Weight map: expected sub-scenes per scene_function
const FUNCTION_WEIGHTS: Record<string, [number, number]> = {
  hook:       [2, 4],
  promessa:   [1, 2],
  erro_comum: [2, 4],
  intuicao:   [2, 4],
  conceito:   [3, 6],
  formula:    [2, 4],
  exemplo:    [3, 6],
  variacao:   [2, 4],
  pegadinha:  [3, 6],
  comparacao: [3, 5],
  checklist:  [2, 3],
  cta:        [1, 2],
  fechamento: [1, 3],
  transicao:  [1, 2],
};

function getTargetForScene(
  sceneFunction: string,
  sceneWordCount: number,
  totalWordCount: number,
  totalTargetSubscenes: number,
): number {
  const weights = FUNCTION_WEIGHTS[sceneFunction] || [2, 4];
  const [minW, maxW] = weights;

  // Proportional target based on word count
  const proportional = Math.round(totalTargetSubscenes * (sceneWordCount / totalWordCount));

  // Clamp to function weight range
  const clamped = Math.max(minW, Math.min(maxW, proportional));

  // For very short scenes (< 20 words), allow 1
  if (sceneWordCount < 20) return Math.max(1, Math.min(2, clamped));

  return Math.max(1, clamped);
}

const SYSTEM_PROMPT = `Você é um editor de storyboard para vídeos educativos de YouTube no estilo Atlas Educa / ENEM.

## SUA TAREFA
Dividir a narração de UMA CENA em sub-cenas com ALTA DENSIDADE VISUAL.

## O QUE É UMA SUB-CENA
Cada sub-cena = 1 ideia única + 1 imagem principal + 1 trecho de áudio.
É a MENOR UNIDADE de explicação visual.

## QUANDO CRIAR NOVA SUB-CENA (7 gatilhos)
Crie uma nova sub-cena SEMPRE que acontecer pelo menos um destes:

A. MUDANÇA DE FOCO DA EXPLICAÇÃO
"probabilidade é muito cobrada" = uma ideia
"o aluno erra porque procura fórmula" = outra ideia
→ sub-cenas separadas

B. MUDANÇA DE IMAGEM IDEAL
Se o trecho pedir duas imagens diferentes, DEVE virar duas sub-cenas.

C. MUDANÇA DE EXEMPLO OU NOVO PASSO DE CÁLCULO
Cada passo de um cálculo deve ser separado:
- identificar o total → sub-cena
- identificar casos favoráveis → sub-cena
- montar a fração → sub-cena

D. CONTRASTE, VIRADA OU CORREÇÃO
"mas", "só que", "agora", "presta atenção", "aqui está a pegadinha" → nova sub-cena.

E. ERRO COMUM VS CORREÇÃO
- resposta errada → sub-cena
- explicação do erro → sub-cena
- resposta certa → sub-cena

F. COMPARAÇÃO ENTRE CENÁRIOS
"com reposição" vs "sem reposição" → sub-cenas separadas

G. NOVA INFORMAÇÃO QUE PRECISA RESPIRAR
Cada "passo mental" do aluno deve ser uma sub-cena.

## REGRAS DE TAMANHO
- Cada sub-cena deve ter entre 12 e 32 palavras (~7-10 segundos de áudio)
- MÁXIMO RECOMENDADO: 38 palavras
- MÍNIMO ABSOLUTO: 8 palavras
- NUNCA gere sub-cena com menos de 8 palavras — junte com anterior ou próximo
- Se um trecho tiver mais de 38 palavras, DIVIDA em duas sub-cenas

## REGRAS DO image_prompt
- Em português, concreto e visual
- Descreva EXATAMENTE o que apareceria na tela
- Seja específico: "aluno olhando para prova do ENEM com expressão de dúvida" > "aluno estudando"
- Cada sub-cena DEVE ter um image_prompt único

## FORMATO DE RESPOSTA
Retorne APENAS JSON válido:
{
  "sub_scenes": [
    {
      "narration_segment": "texto exato da narração desta sub-cena",
      "image_prompt": "descrição visual concreta para esta sub-cena"
    }
  ]
}

## REGRAS GERAIS
- Preserve a narração EXATAMENTE como recebida — não reescreva, não resuma, não adicione
- A concatenação de todas as narration_segment deve reproduzir o texto original completo
- Não use markdown fora do JSON
- SIGA A META de sub-cenas informada no prompt`;

function getMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("\n")
    .trim();
}

function extractAndParseJson(content: string): unknown {
  const cleaned = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const candidates = new Set<string>([cleaned]);
  const fb = cleaned.indexOf("{");
  const lb = cleaned.lastIndexOf("}");
  if (fb !== -1 && lb > fb) candidates.add(cleaned.slice(fb, lb + 1));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* */ }
    try {
      let repaired = c.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, "");
      let braces = 0, brackets = 0;
      for (const ch of repaired) { if (ch === "{") braces++; if (ch === "}") braces--; if (ch === "[") brackets++; if (ch === "]") brackets--; }
      while (brackets > 0) { repaired += "]"; brackets--; }
      while (braces > 0) { repaired += "}"; braces--; }
      return JSON.parse(repaired);
    } catch { /* */ }
  }
  throw new Error("Não foi possível extrair JSON válido da resposta da IA");
}

// Merge sub-scenes that are too short (< 8 words) into their neighbor
function mergeShortSubScenes(subScenes: SubSceneOutput[]): SubSceneOutput[] {
  if (subScenes.length <= 1) return subScenes;

  const result: SubSceneOutput[] = [subScenes[0]];

  for (let i = 1; i < subScenes.length; i++) {
    const current = subScenes[i];
    const wordCount = current.narration_segment.trim().split(/\s+/).length;

    if (wordCount < 8) {
      // Merge into previous
      const prev = result[result.length - 1];
      result[result.length - 1] = {
        narration_segment: prev.narration_segment + " " + current.narration_segment,
        image_prompt: prev.image_prompt, // keep the previous prompt
      };
    } else {
      result.push(current);
    }
  }

  // Check if the first one is also too short after merge
  if (result.length > 1 && result[0].narration_segment.trim().split(/\s+/).length < 8) {
    const first = result.shift()!;
    result[0] = {
      narration_segment: first.narration_segment + " " + result[0].narration_segment,
      image_prompt: result[0].image_prompt,
    };
  }

  return result;
}

async function callAI(apiKey: string, messages: { role: string; content: string }[], maxTokens = 16384): Promise<any> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  for (let i = 0; i < models.length; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: models[i], messages,
          temperature: 0.4,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.status === 429) throw { status: 429, message: "Rate limit atingido." };
      if (response.status === 402) throw { status: 402, message: "Créditos esgotados." };
      if (!response.ok) throw new Error(`AI erro [${response.status}]: ${await response.text()}`);
      return await response.json();
    } catch (error: any) {
      clearTimeout(timer);
      if (error?.status === 429 || error?.status === 402) throw error;
      if (i === models.length - 1) throw error;
      console.warn(`Modelo ${models[i]} falhou, tentando fallback`);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { narration, scene_title, scene_function, total_word_count, total_scenes } = await req.json();
    if (!narration?.trim()) throw new Error("Narração é obrigatória");

    const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!apiKey) throw new Error("GOOGLE_AI_API_KEY não configurada");

    const sceneWordCount = narration.trim().split(/\s+/).length;
    const totalWords = total_word_count || sceneWordCount;
    const estimatedDurationSec = (totalWords / 167) * 60;
    const totalTargetSubscenes = Math.round(estimatedDurationSec / 8.5);

    const fn = scene_function || "conceito";
    const sceneTarget = getTargetForScene(fn, sceneWordCount, totalWords, totalTargetSubscenes);

    const functionLabel = fn.replace(/_/g, " ");

    const densityInstruction = `\n\nCONTEXTO DESTA CENA:
- Função narrativa: ${functionLabel}
- Palavras nesta cena: ${sceneWordCount}
- Total de palavras do roteiro: ${totalWords}
- Duração estimada do vídeo: ${Math.round(estimatedDurationSec)}s
- Meta total de sub-cenas do vídeo: ${totalTargetSubscenes}
- META PARA ESTA CENA: ${sceneTarget} sub-cenas (mínimo ${Math.max(1, sceneTarget - 1)}, máximo ${sceneTarget + 2})
- Se gerar menos de ${Math.max(1, sceneTarget - 1)}, REDIVIDA com maior granularidade
- Se a cena for curta e simples, 1 sub-cena é aceitável — NÃO force divisões artificiais`;

    let userMessage = scene_title
      ? `CENA (${functionLabel}): ${scene_title}\n\nNARRAÇÃO:\n${narration.trim()}`
      : `CENA (${functionLabel}):\n\nNARRAÇÃO:\n${narration.trim()}`;
    userMessage += densityInstruction;

    const result = await callAI(apiKey, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    const text = getMessageContent(result.choices?.[0]?.message?.content);
    if (!text.trim()) throw new Error("IA retornou resposta vazia");

    const parsed = extractAndParseJson(text) as any;
    let subScenes: SubSceneOutput[] = (parsed.sub_scenes || [])
      .filter((s: any) => s?.narration_segment?.trim())
      .map((s: any) => ({
        narration_segment: s.narration_segment.trim(),
        image_prompt: s.image_prompt?.trim() || null,
      }));

    if (subScenes.length === 0) throw new Error("IA não retornou sub-cenas válidas");

    // Post-processing: merge sub-scenes that are too short
    subScenes = mergeShortSubScenes(subScenes);

    // Cap: if way over target, log warning
    const maxAllowed = sceneTarget + 3;
    if (subScenes.length > maxAllowed) {
      console.warn(`Scene "${fn}" generated ${subScenes.length} sub-scenes, target was ${sceneTarget}. Capping at ${maxAllowed}.`);
      // Merge from the end to reduce count
      while (subScenes.length > maxAllowed && subScenes.length > 1) {
        const last = subScenes.pop()!;
        subScenes[subScenes.length - 1] = {
          narration_segment: subScenes[subScenes.length - 1].narration_segment + " " + last.narration_segment,
          image_prompt: subScenes[subScenes.length - 1].image_prompt,
        };
      }
    }

    console.log(`Scene "${fn}": target=${sceneTarget}, generated=${subScenes.length} (${sceneWordCount} words)`);

    return new Response(JSON.stringify({ sub_scenes: subScenes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("split-sub-scenes error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Erro desconhecido" }), {
      status: error?.status || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
