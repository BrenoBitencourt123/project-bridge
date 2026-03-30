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
};

type AdaptScriptResponse = {
  video_script: VideoScriptItem[];
};

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
  while (brackets > 0) {
    repaired += "]";
    brackets--;
  }
  while (braces > 0) {
    repaired += "}";
    braces--;
  }

  return repaired
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, "");
}

function tryParseJson(candidate: string): unknown | null {
  if (!candidate.trim()) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    // continue
  }
  try {
    return JSON.parse(repairJson(candidate));
  } catch {
    // continue
  }
  return null;
}

function getMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("\n")
    .trim();
}

function extractAndParseJson(content: string): unknown {
  const cleaned = content
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

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

  if (!source) {
    throw new Error("Resposta da IA não contém video_script válido");
  }

  const video_script = source
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const time = typeof record.time === "string" ? record.time.trim() : "";
      const narration = typeof record.narration === "string" ? record.narration.trim() : "";
      const visual = typeof record.visual === "string" ? record.visual.trim() : "";

      if (!time || !narration || !visual) return null;
      return { time, narration, visual };
    })
    .filter((item): item is VideoScriptItem => Boolean(item));

  if (!video_script.length) {
    throw new Error("Resposta da IA não contém video_script válido");
  }

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
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 429) {
        throw { status: 429, message: "Rate limit atingido. Tente novamente em alguns instantes." };
      }
      if (response.status === 402) {
        throw { status: 402, message: "Créditos de IA esgotados. Adicione créditos no painel do Lovable." };
      }
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI Gateway erro [${response.status}]: ${errText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timer);
      if (error?.status === 429 || error?.status === 402) throw error;
      if (index === models.length - 1) throw error;
      console.warn(`Modelo ${model} falhou, tentando fallback:`, error?.message || error);
    }
  }
}

const SYSTEM_PROMPT = `Você adapta roteiros brutos para um formato estruturado de vídeo.

Retorne APENAS JSON válido no formato:
{
  "video_script": [
    {
      "time": "MM:SS - MM:SS",
      "narration": "...",
      "visual": "..."
    }
  ]
}

Regras obrigatórias:
- Preserve a narração original quase intacta.
- Faça apenas correções mínimas de gramática, fluidez e TTS.
- Não adicione conteúdo novo.
- Não remova ideias do texto.
- Não resuma demais.
- Divida em blocos de 60 a 120 palavras. Gere entre 20 e 35 blocos no total.
- Calcule timestamps sequenciais usando 1 palavra ≈ 0.4 segundos.
- O campo "narration" deve conter apenas o texto falado do bloco.
- O campo "visual" deve ser em português, concreto, claro e útil para orientar edição/geração visual.
- O campo "visual" deve ser detalhado, mas objetivo, com no máximo 3 frases curtas.
- Adapte TTS quando necessário: números, datas, porcentagens, siglas e fórmulas devem soar naturais em voz alta.
- Não use markdown.
- Não use comentários.
- Não escreva texto antes ou depois do JSON.
- Não inclua outras chaves além de "video_script".`;

const JSON_REPAIR_PROMPT = `Você corrige respostas JSON inválidas.

Retorne APENAS JSON válido no formato:
{
  "video_script": [
    {
      "time": "MM:SS - MM:SS",
      "narration": "...",
      "visual": "..."
    }
  ]
}

Regras obrigatórias:
- Preserve ao máximo o conteúdo já existente.
- Não invente conteúdo novo.
- Se algum item estiver incompleto ou quebrado, remova somente o item incompleto.
- Não adicione chaves extras.
- Não escreva explicações.
- Responda somente com JSON válido.`;

async function parseAdaptScriptResponse(apiKey: string, text: string): Promise<AdaptScriptResponse> {
  try {
    return normalizeParsedResponse(extractAndParseJson(text));
  } catch (parseError) {
    console.warn(
      "Primary JSON parse failed, attempting AI repair:",
      parseError instanceof Error ? parseError.message : parseError,
    );

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
    if (!repairedText.trim()) {
      throw parseError;
    }

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

    const userMessage = `ROTEIRO BRUTO:\n\n${script.trim()}`;

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

    if (!text.trim()) {
      throw new Error("A IA retornou uma resposta vazia");
    }

    if (finishReason === "length") {
      throw new Error("A resposta da IA foi truncada antes de concluir o JSON. Tente um roteiro menor ou gere em partes.");
    }

    const parsed = await parseAdaptScriptResponse(GOOGLE_AI_API_KEY, text);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("adapt-script error:", error);
    const status = error?.status || 500;
    const message = error?.message || (error instanceof Error ? error.message : "Erro desconhecido");
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
