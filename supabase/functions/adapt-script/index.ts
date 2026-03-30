import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TIMEOUT_MS = 55_000;
const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";
const PRIMARY_MAX_TOKENS = 16_384;
const REPAIR_MAX_TOKENS = 12_288;

type VideoScriptItem = {
  time: string;
  narration: string;
  visual: string;
  scene_function: string;
};

type AdaptScriptResponse = {
  video_script: VideoScriptItem[];
};

const VALID_SCENE_FUNCTIONS = [
  "hook", "promessa", "erro_comum", "intuicao", "conceito",
  "formula", "exemplo", "variacao", "pegadinha", "comparacao",
  "checklist", "cta", "fechamento", "transicao",
];

function normalizeSceneFunction(fn: string | undefined | null): string {
  if (!fn) return "conceito";
  const normalized = fn.trim().toLowerCase()
    .replace(/[áàã]/g, "a").replace(/[éê]/g, "e").replace(/[íî]/g, "i")
    .replace(/[óôõ]/g, "o").replace(/[úû]/g, "u").replace(/[ç]/g, "c")
    .replace(/\s+/g, "_").replace(/[^a-z_]/g, "");
  if (VALID_SCENE_FUNCTIONS.includes(normalized)) return normalized;
  // fuzzy match
  if (normalized.includes("hook") || normalized.includes("abertura") || normalized.includes("dor")) return "hook";
  if (normalized.includes("promessa")) return "promessa";
  if (normalized.includes("erro")) return "erro_comum";
  if (normalized.includes("intuic")) return "intuicao";
  if (normalized.includes("conceit")) return "conceito";
  if (normalized.includes("formul")) return "formula";
  if (normalized.includes("exempl")) return "exemplo";
  if (normalized.includes("variac")) return "variacao";
  if (normalized.includes("pegad")) return "pegadinha";
  if (normalized.includes("compar")) return "comparacao";
  if (normalized.includes("check") || normalized.includes("resum")) return "checklist";
  if (normalized.includes("cta") || normalized.includes("chamada")) return "cta";
  if (normalized.includes("fecha") || normalized.includes("conclus")) return "fechamento";
  if (normalized.includes("transic")) return "transicao";
  return "conceito";
}

function repairJson(json: string): string {
  let braces = 0;
  let brackets = 0;
  for (const c of json) {
    if (c === "{") braces++;
    if (c === "}") braces--;
    if (c === "[") brackets++;
    if (c === "]") brackets--;
  }
  let repaired = json;
  while (brackets > 0) { repaired += "]"; brackets--; }
  while (braces > 0) { repaired += "}"; braces--; }
  return repaired
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, "");
}

function tryParseJson(candidate: string): unknown | null {
  if (!candidate.trim()) return null;
  try { return JSON.parse(candidate); } catch { /* */ }
  try { return JSON.parse(repairJson(candidate)); } catch { /* */ }
  return null;
}

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
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBrace !== -1) candidates.add(cleaned.slice(firstBrace));
  if (firstBrace !== -1 && lastBrace > firstBrace) candidates.add(cleaned.slice(firstBrace, lastBrace + 1));
  if (firstBracket !== -1) candidates.add(cleaned.slice(firstBracket));
  if (firstBracket !== -1 && lastBracket > firstBracket) candidates.add(cleaned.slice(firstBracket, lastBracket + 1));
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed !== null) return parsed;
  }
  throw new Error("Não foi possível extrair JSON válido da resposta da IA");
}

function normalizeParsedResponse(parsed: unknown): AdaptScriptResponse {
  const source = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).video_script)
      ? ((parsed as Record<string, unknown>).video_script as unknown[])
      : null;

  if (!source) throw new Error("Resposta da IA não contém video_script válido");

  const video_script = source
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const time = typeof record.time === "string" ? record.time.trim() : "";
      const narration = typeof record.narration === "string" ? record.narration.trim() : "";
      const visual = typeof record.visual === "string" ? record.visual.trim() : "";
      const scene_function = normalizeSceneFunction(
        typeof record.scene_function === "string" ? record.scene_function : null
      );
      if (!time || !narration || !visual) return null;
      return { time, narration, visual, scene_function };
    })
    .filter((item): item is VideoScriptItem => Boolean(item));

  if (!video_script.length) throw new Error("Resposta da IA não contém video_script válido");
  return { video_script };
}

async function callAIWithFallback(
  apiKey: string,
  messages: { role: string; content: string }[],
  temperature: number,
  maxTokens = PRIMARY_MAX_TOKENS,
): Promise<any> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      console.log(`Trying model: ${model}`);
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, messages, temperature,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.status === 429) throw { status: 429, message: "Rate limit atingido." };
      if (response.status === 402) throw { status: 402, message: "Créditos esgotados." };
      if (!response.ok) throw new Error(`AI Gateway erro [${response.status}]: ${await response.text()}`);
      return await response.json();
    } catch (error: any) {
      clearTimeout(timer);
      if (error?.status === 429 || error?.status === 402) throw error;
      if (index === models.length - 1) throw error;
      console.warn(`Modelo ${model} falhou, tentando fallback:`, error?.message || error);
    }
  }
}

const SYSTEM_PROMPT = `Você é um diretor de storyboard para vídeos educativos de YouTube no estilo Atlas Educa / ENEM 2026.

## SUA TAREFA
Transformar um roteiro bruto em **macroblocos narrativos** — cenas organizadas por FUNÇÃO ESTRATÉGICA no vídeo, não por tamanho de texto.

## O QUE É UMA CENA (MACROBLOCO NARRATIVO)
Cada cena = um bloco que cumpre uma FUNÇÃO específica na jornada de aprendizagem do aluno.
NÃO é um "pedaço de texto de X palavras". É um PAPEL no roteiro.

## FUNÇÕES NARRATIVAS (use como scene_function)
Identifique e classifique cada trecho do roteiro em uma destas funções:

- **hook**: Abertura que conecta com a dor/curiosidade do aluno (ex: "todo mundo erra isso", estatísticas de erro)
- **promessa**: O que o aluno vai aprender/ganhar ao assistir
- **erro_comum**: Erro típico que o aluno comete — mostra o que NÃO fazer
- **intuicao**: Construção da lógica simples antes do conceito técnico
- **conceito**: Explicação teórica, definição, regra
- **formula**: Apresentação de fórmula, equação, método de cálculo
- **exemplo**: Aplicação prática com dados concretos, resolução passo a passo
- **variacao**: Mudança de cenário no mesmo conceito (ex: com reposição vs sem reposição)
- **pegadinha**: Armadilha do ENEM, erro sutil, "cuidado com isso"
- **comparacao**: Confronto entre dois cenários/métodos/resultados
- **checklist**: Resumo, lista de passos, revisão rápida
- **cta**: Chamada para ação (inscrever, comentar, próximo vídeo)
- **fechamento**: Conclusão, recapitulação final
- **transicao**: Conexão breve entre blocos maiores

## REGRAS DE SEGMENTAÇÃO
1. Gere entre **8 e 14 cenas** para um roteiro de ~6 minutos (~1000 palavras)
2. Cada cena deve ter entre **40 e 180 palavras** — mas o tamanho varia conforme a função
3. Cenas de hook, promessa, CTA e transição tendem a ser CURTAS (40-80 palavras)
4. Cenas de conceito, exemplo, pegadinha tendem a ser LONGAS (80-180 palavras)
5. Preserve a narração original — não reescreva, não resuma, não adicione conteúdo
6. Faça apenas correções mínimas de gramática, fluidez e TTS
7. Adapte TTS: números, datas, porcentagens, siglas e fórmulas devem soar naturais em voz alta

## COMO DECIDIR ONDE CORTAR
- Corte quando a FUNÇÃO NARRATIVA muda (de hook para promessa, de conceito para exemplo, etc.)
- Corte quando há VIRADA DE RACIOCÍNIO ("mas", "só que", "agora vem a parte importante")
- NÃO corte no meio de um exemplo ou cálculo — mantenha o bloco inteiro
- NÃO corte por tamanho arbitrário — respeite a unidade lógica do trecho

## FORMATO DE RESPOSTA
Retorne APENAS JSON válido:
{
  "video_script": [
    {
      "time": "MM:SS - MM:SS",
      "narration": "texto exato da narração desta cena",
      "visual": "descrição visual concreta para orientar edição/geração de imagens",
      "scene_function": "hook|promessa|erro_comum|intuicao|conceito|formula|exemplo|variacao|pegadinha|comparacao|checklist|cta|fechamento|transicao"
    }
  ]
}

## REGRAS DO CAMPO visual
- Em português, concreto e visual
- Descreva EXATAMENTE o que apareceria na tela como orientação para storyboard
- Seja específico: "aluno olhando para prova do ENEM com expressão confusa" > "aluno estudando"
- Máximo 3 frases curtas

## REGRAS GERAIS
- Calcule timestamps sequenciais usando 1 palavra ≈ 0.4 segundos
- A concatenação de todas as narrações deve reproduzir o roteiro original completo
- Não use markdown fora do JSON
- Não escreva texto antes ou depois do JSON
- Não inclua chaves extras além de "video_script"`;

const JSON_REPAIR_PROMPT = `Você corrige respostas JSON inválidas.

Retorne APENAS JSON válido no formato:
{
  "video_script": [
    {
      "time": "MM:SS - MM:SS",
      "narration": "...",
      "visual": "...",
      "scene_function": "..."
    }
  ]
}

Regras:
- Preserve ao máximo o conteúdo existente.
- Não invente conteúdo novo.
- Se algum item estiver incompleto, remova somente o item.
- Responda somente com JSON válido.`;

async function parseAdaptScriptResponse(apiKey: string, text: string): Promise<AdaptScriptResponse> {
  try {
    return normalizeParsedResponse(extractAndParseJson(text));
  } catch (parseError) {
    console.warn("Primary JSON parse failed, attempting AI repair:", parseError instanceof Error ? parseError.message : parseError);
    const repairResult = await callAIWithFallback(
      apiKey,
      [
        { role: "system", content: JSON_REPAIR_PROMPT },
        { role: "user", content: `Conserte este JSON inválido sem inventar conteúdo:\n\n${text}` },
      ],
      0,
      REPAIR_MAX_TOKENS,
    );
    const repairedText = getMessageContent(repairResult.choices?.[0]?.message?.content);
    if (!repairedText.trim()) throw parseError;
    return normalizeParsedResponse(extractAndParseJson(repairedText));
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { script } = await req.json();
    if (!script || !script.trim()) throw new Error("Roteiro é obrigatório");

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY não configurada");

    const wordCount = script.trim().split(/\s+/).length;
    const estimatedDurationSec = (wordCount / 167) * 60;
    const targetScenes = Math.min(14, Math.max(8, Math.round(estimatedDurationSec / 35)));

    const userMessage = `ROTEIRO BRUTO (${wordCount} palavras, ~${Math.round(estimatedDurationSec)}s estimados):

META: Gere entre ${Math.max(8, targetScenes - 2)} e ${Math.min(16, targetScenes + 2)} macroblocos narrativos.

${script.trim()}`;

    const result = await callAIWithFallback(
      GOOGLE_AI_API_KEY,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      0.3,
    );

    const choice = result.choices?.[0];
    const finishReason = choice?.finish_reason;
    const text = getMessageContent(choice?.message?.content);

    console.log(`AI finish_reason: ${finishReason ?? "unknown"}, content_length: ${text.length}`);

    if (!text.trim()) throw new Error("A IA retornou uma resposta vazia");
    if (finishReason === "length") {
      throw new Error("A resposta da IA foi truncada. Tente um roteiro menor.");
    }

    const parsed = await parseAdaptScriptResponse(GOOGLE_AI_API_KEY, text);

    console.log(`Generated ${parsed.video_script.length} narrative blocks: ${parsed.video_script.map(s => s.scene_function).join(", ")}`);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("adapt-script error:", error);
    const status = error?.status || 500;
    const message = error?.message || "Erro desconhecido";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
