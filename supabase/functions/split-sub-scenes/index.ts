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

const SYSTEM_PROMPT = `Você é um editor de vídeos educativos. Sua tarefa é dividir a narração de UMA CENA em sub-cenas.

## O que é uma sub-cena
Cada sub-cena = 1 ideia única + 1 imagem + 1 trecho de áudio.

## Quando cortar uma nova sub-cena
Crie uma nova sub-cena sempre que acontecer pelo menos uma destas coisas:
- Muda o foco da explicação
- Muda a imagem ideal (o visual que acompanha mudou)
- Muda o exemplo
- Entra uma nova informação que precisa respirar
- Entra uma virada de raciocínio
- O aluno precisa de uma pausa mental

## Regras de tamanho
- Cada sub-cena deve ter entre 15 e 35 palavras (~7-12 segundos de áudio)
- Se um trecho é muito curto (< 10 palavras), junte com o anterior ou próximo
- Se um trecho é muito longo (> 40 palavras), divida em duas sub-cenas

## Regras do image_prompt
- O image_prompt deve ser em português, concreto e visual
- Descreva exatamente o que apareceria na tela durante aquele trecho
- Seja específico: "aluno olhando para prova do ENEM com expressão de dúvida" é melhor que "aluno estudando"
- Inclua estilo visual quando relevante: gráficos, diagramas, animações, close-ups
- Cada sub-cena DEVE ter um image_prompt único e relevante à sua narração

## Formato de resposta
Retorne APENAS JSON válido:
{
  "sub_scenes": [
    {
      "narration_segment": "texto exato da narração desta sub-cena",
      "image_prompt": "descrição visual concreta para esta sub-cena"
    }
  ]
}

## Regras gerais
- Preserve a narração EXATAMENTE como recebida — não reescreva, não resuma, não adicione palavras
- A concatenação de todas as narration_segment deve reproduzir o texto original completo
- Não use markdown, não escreva explicações fora do JSON`;

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
      // close unclosed brackets
      let braces = 0, brackets = 0;
      for (const ch of repaired) { if (ch === "{") braces++; if (ch === "}") braces--; if (ch === "[") brackets++; if (ch === "]") brackets--; }
      while (brackets > 0) { repaired += "]"; brackets--; }
      while (braces > 0) { repaired += "}"; braces--; }
      return JSON.parse(repaired);
    } catch { /* continue */ }
  }
  throw new Error("Não foi possível extrair JSON válido da resposta da IA");
}

async function callAI(apiKey: string, messages: { role: string; content: string }[]): Promise<any> {
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
          temperature: 0.3,
          max_tokens: 8192,
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
    const { narration, scene_title } = await req.json();
    if (!narration?.trim()) throw new Error("Narração é obrigatória");

    const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!apiKey) throw new Error("GOOGLE_AI_API_KEY não configurada");

    const userMessage = scene_title
      ? `CENA: ${scene_title}\n\nNARRAÇÃO:\n${narration.trim()}`
      : `NARRAÇÃO:\n${narration.trim()}`;

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
