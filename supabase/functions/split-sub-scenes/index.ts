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
"não começa na fórmula, começa na leitura" = outra ideia
→ 3 sub-cenas

B. MUDANÇA DE IMAGEM IDEAL
Se o trecho pedir duas imagens diferentes, DEVE virar duas sub-cenas.
Ex: "aluno travado na prova" vs "fórmula na tela" vs "dado com números" → sub-cenas separadas

C. MUDANÇA DE EXEMPLO OU NOVO PASSO DE CÁLCULO
Cada passo de um cálculo ou exemplo deve ser separado:
- identificar o total → sub-cena
- identificar casos favoráveis → sub-cena
- montar a fração → sub-cena
- simplificar → sub-cena

D. CONTRASTE, VIRADA OU CORREÇÃO
Palavras como "mas", "só que", "agora", "presta atenção", "aqui está a pegadinha", "nesse caso", "por outro lado" geralmente marcam nova sub-cena.

E. ERRO COMUM VS CORREÇÃO
- resposta errada → sub-cena
- explicação do erro → sub-cena
- resposta certa → sub-cena

F. COMPARAÇÃO ENTRE CENÁRIOS
"com reposição" vs "sem reposição" → sub-cenas separadas, mesmo no mesmo parágrafo

G. NOVA INFORMAÇÃO QUE PRECISA RESPIRAR / PAUSA MENTAL DO ALUNO
Cada "passo mental" do aluno deve ser uma sub-cena:
- qual é o problema?
- por que eu erro?
- qual é a lógica?
- como aplica?

## REGRAS DE TAMANHO
- Cada sub-cena deve ter entre 12 e 32 palavras (~7-10 segundos de áudio)
- MÁXIMO RECOMENDADO: 38 palavras
- Se um trecho tiver mais de 38 palavras, DIVIDA em duas sub-cenas
- Se um trecho tiver menos de 10 palavras, junte com anterior ou próximo (APENAS se forem a mesma ideia/imagem)

## META DE DENSIDADE
Você receberá uma META de sub-cenas calculada para esta cena.
SIGA A META. Se sua primeira divisão gerar menos sub-cenas que a meta, REDIVIDA:
- Separe contrastes (mas, só que, porém)
- Separe perguntas de suas respostas
- Separe introdução de conceito da definição
- Separe explicação do cálculo
- Separe cálculo da conclusão
- Separe erro comum da correção
- Separe cenários comparados

## REGRAS DO image_prompt
- Em português, concreto e visual
- Descreva EXATAMENTE o que apareceria na tela
- Seja específico: "aluno olhando para prova do ENEM com expressão de dúvida" > "aluno estudando"
- Inclua estilo visual quando relevante: gráficos, diagramas, close-ups
- Cada sub-cena DEVE ter um image_prompt único

## EXEMPLOS DE PENSAMENTO CORRETO

EXEMPLO 1:
"Probabilidade é um dos temas mais cobrados no ENEM — e também um dos que mais fazem aluno errar. E quase nunca é porque a conta é difícil. O aluno erra porque tenta resolver antes de entender o que está acontecendo."
→ 3 sub-cenas (3 ideias, 3 imagens possíveis):
1. "Probabilidade é um dos temas mais cobrados no ENEM — e também um dos que mais fazem aluno errar."
2. "E quase nunca é porque a conta é difícil."
3. "O aluno erra porque tenta resolver antes de entender o que está acontecendo."

EXEMPLO 2:
"Você tira uma bola azul e não coloca de volta. Qual é a probabilidade de a próxima bola também ser azul? Muita gente responde 3 sobre 9 no automático. Só que isso estaria certo apenas se o cenário continuasse igual."
→ 3+ sub-cenas: cenário da retirada, erro comum, correção da lógica

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
- Preserve a narração EXATAMENTE como recebida — não reescreva, não resuma, não adicione palavras
- A concatenação de todas as narration_segment deve reproduzir o texto original completo
- Não use markdown, não escreva explicações fora do JSON
- PREFIRA EXCESSO LEVE de sub-cenas a falta de sub-cenas`;

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
    try { return JSON.parse(c); } catch { /* continue */ }
    try {
      let repaired = c.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, "");
      let braces = 0, brackets = 0;
      for (const ch of repaired) { if (ch === "{") braces++; if (ch === "}") braces--; if (ch === "[") brackets++; if (ch === "]") brackets--; }
      while (brackets > 0) { repaired += "]"; brackets--; }
      while (braces > 0) { repaired += "}"; braces--; }
      return JSON.parse(repaired);
    } catch { /* continue */ }
  }
  throw new Error("Não foi possível extrair JSON válido da resposta da IA");
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
          model: models[i],
          messages,
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
    const { narration, scene_title, total_word_count, total_scenes } = await req.json();
    if (!narration?.trim()) throw new Error("Narração é obrigatória");

    const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!apiKey) throw new Error("GOOGLE_AI_API_KEY não configurada");

    // Calculate density target
    const sceneWordCount = narration.trim().split(/\s+/).length;
    const totalWords = total_word_count || sceneWordCount;
    const numScenes = total_scenes || 1;
    const estimatedDurationSec = (totalWords / 167) * 60;
    const totalTargetSubscenes = Math.round(estimatedDurationSec / 8.5);
    // Distribute proportionally to this scene
    const sceneProportion = sceneWordCount / totalWords;
    const sceneTarget = Math.max(2, Math.round(totalTargetSubscenes * sceneProportion));

    const densityInstruction = `\n\nMETA DE DENSIDADE PARA ESTA CENA:
- Palavras nesta cena: ${sceneWordCount}
- Total de palavras do roteiro: ${totalWords}
- Duração estimada do vídeo: ${Math.round(estimatedDurationSec)}s
- Meta total de sub-cenas do vídeo: ${totalTargetSubscenes}
- META PARA ESTA CENA: ${sceneTarget} sub-cenas (mínimo ${Math.max(1, sceneTarget - 1)}, máximo ${sceneTarget + 2})
- Se gerar menos de ${Math.max(1, sceneTarget - 1)} sub-cenas, REDIVIDA com maior granularidade`;

    let userMessage = scene_title
      ? `CENA: ${scene_title}\n\nNARRAÇÃO:\n${narration.trim()}`
      : `NARRAÇÃO:\n${narration.trim()}`;
    userMessage += densityInstruction;

    const result = await callAI(apiKey, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    const text = getMessageContent(result.choices?.[0]?.message?.content);
    if (!text.trim()) throw new Error("IA retornou resposta vazia");

    const parsed = extractAndParseJson(text) as any;
    const subScenes: SubSceneOutput[] = (parsed.sub_scenes || [])
      .filter((s: any) => s?.narration_segment?.trim())
      .map((s: any) => ({
        narration_segment: s.narration_segment.trim(),
        image_prompt: s.image_prompt?.trim() || null,
      }));

    if (subScenes.length === 0) throw new Error("IA não retornou sub-cenas válidas");

    console.log(`Scene target: ${sceneTarget}, generated: ${subScenes.length} sub-scenes (${sceneWordCount} words)`);

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
