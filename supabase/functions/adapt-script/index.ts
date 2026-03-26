import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TIMEOUT_MS = 55_000;
const PRIMARY_MODEL = "google/gemini-2.5-flash";
const FALLBACK_MODEL = "google/gemini-2.5-flash-lite";

function repairJson(json: string): string {
  let braces = 0, brackets = 0;
  for (const c of json) {
    if (c === '{') braces++;
    if (c === '}') braces--;
    if (c === '[') brackets++;
    if (c === ']') brackets--;
  }
  let r = json;
  while (brackets > 0) { r += ']'; brackets--; }
  while (braces > 0) { r += '}'; braces--; }
  return r
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, "");
}

function extractAndParseJson(content: string): unknown {
  try { return JSON.parse(content); } catch { /* continue */ }
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch { /* continue */ }
  }
  const jsonMatch = content.match(/\{[\s\S]*"[^"]+"\s*:[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* continue */ }
    try { return JSON.parse(repairJson(jsonMatch[0])); } catch { /* continue */ }
  }
  try { return JSON.parse(repairJson(content)); } catch { /* continue */ }
  throw new Error("Não foi possível extrair JSON válido da resposta da IA");
}

async function callAIWithFallback(
  apiKey: string,
  messages: { role: string; content: string }[],
  temperature: number
): Promise<any> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      console.log(`Trying model: ${model}`);
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages, temperature, max_tokens: 8192 }),
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
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.status === 429 || e?.status === 402) throw e;
      if (i === models.length - 1) throw e;
      console.warn(`Modelo ${model} falhou, tentando fallback:`, e.message || e);
    }
  }
}

const SYSTEM_PROMPT = `Você é um roteirista profissional de vídeos educacionais para YouTube, especializado em conteúdos que ajudam estudantes a se prepararem para o ENEM 2026.

Você vai receber um ROTEIRO DE NARRAÇÃO BRUTO colado pelo usuário.
Sua tarefa é ADAPTAR esse roteiro para o formato padrão com cenas visuais.

REGRAS CRÍTICAS:

MANTENHA O TEXTO ORIGINAL DA NARRAÇÃO praticamente inalterado.
Você pode fazer apenas correções mínimas de gramática, fluidez e TTS, sem mudar a ideia, sem adicionar conteúdo novo e sem remover partes do texto.

Divida o roteiro em BLOCOS de 30 a 90 palavras cada.

Para CADA bloco, crie uma descrição visual detalhada no campo "visual", descrevendo a cena ideal para acompanhar a narração.

Calcule os tempos aproximados de cada bloco usando esta regra:
1 palavra ≈ 0.4 segundos
150 palavras por minuto

Numere os blocos em timestamps sequenciais.

Aplique formatação TTS quando necessário:
- números por extenso
- porcentagens por extenso
- anos por extenso quando soar melhor para narração
- fórmulas e expressões matemáticas adaptadas para leitura natural
- siglas lidas de forma fonética quando necessário

Exemplos de adaptação TTS:
- 10% → "dez por cento"
- 1º grau → "primeiro grau"
- 2º grau → "segundo grau"
- x² → "xis ao quadrado"
- f(x) → "efe de xis"
- km/h → "quilômetros por hora"
- ENEM → "enêm"
- IA → "i-a"
- UFU → "u-efe-u"

NÃO adicione conteúdo novo à narração.
NÃO remova partes da narração.
NÃO resuma o texto.
NÃO reescreva completamente o roteiro.
NÃO transforme o texto em aula formal ou apostila.

A narração deve continuar com linguagem natural, falada, leve e boa para vídeo de YouTube.

As descrições visuais devem seguir estas diretrizes:
- foco em clareza didática
- cenas simples, visuais e fáceis de entender
- estética educacional envolvente
- preferência por elementos como caderno, quadro, setas, destaques, gráficos simples, tabelas, palavras-chave na tela, comparações visuais, metáforas fáceis e exemplos concretos
- quando fizer sentido, usar estilo visual escolar/desenhado à mão, com sensação de estudo e acentos em azul
- mostrar visualmente a lógica do que está sendo explicado
- transformar conceitos abstratos em imagens fáceis de entender
- usar texto na tela apenas quando realmente ajudar a retenção
- destacar erros comuns, palavras-chave e raciocínios importantes
- manter as cenas genéricas, sem citar marcas, logos ou nomes de canais

Se o bloco falar de:
- matemática: priorize números, contas, setas, gráficos, comparações e destaque de erro comum
- redação: priorize estrutura visual, blocos de texto, palavras-chave, repertório, tese, conectivos e comparação entre versão fraca e versão forte
- interpretação: priorize trechos destacados, palavras-chave, alternativas, comparação de sentidos e pegadinhas
- ciências da natureza ou humanas: priorize esquemas simples, relações de causa e efeito, linha do tempo, mapas, ícones e comparações visuais

As descrições visuais nunca devem depender de marcas específicas ou de assets impossíveis.
Elas devem ser viáveis para edição com imagens, motion simples, ilustrações, elementos gráficos e apoio visual de YouTube.

FOCO EDITORIAL:
Sempre que fizer sentido, trate o conteúdo como material voltado para o ENEM 2026.
No campo "youtube_description" e no campo "youtube_tags", priorize SEO voltado para ENEM 2026.

FORMATO DE SAÍDA:
Responda APENAS com JSON válido.

{
  "video_script": [
    {
      "time": "MM:SS - MM:SS",
      "narration": "texto da narração do bloco",
      "visual": "descrição detalhada da cena/imagem"
    }
  ],
  "youtube_description": "descrição otimizada para YouTube com emojis, boa formatação, linguagem natural, foco em SEO e menções estratégicas a ENEM 2026 quando fizer sentido",
  "youtube_tags": ["tag1", "tag2", "tag3"]
}

REGRAS DO JSON:
- O campo "narration" deve conter APENAS o texto falado daquele bloco
- O campo "visual" deve descrever a cena com detalhes suficientes para orientar edição ou geração visual
- O campo "time" deve seguir ordem cronológica contínua
- O campo "youtube_description" deve ser escaneável, clara e otimizada para clique e busca
- O campo "youtube_tags" deve conter de 8 a 12 tags relevantes
- Não escreva explicações fora do JSON
- Não use markdown
- Não coloque comentários
- Responda somente com o JSON final`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { script } = await req.json();
    if (!script || !script.trim()) throw new Error("Roteiro é obrigatório");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurada");

    const userMessage = `ROTEIRO BRUTO:\n\n${script.trim()}`;

    const result = await callAIWithFallback(
      LOVABLE_API_KEY,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      0.3
    );

    const text = result.choices?.[0]?.message?.content || "{}";
    const parsed = extractAndParseJson(text) as { video_script?: any[] };

    if (!parsed.video_script || !Array.isArray(parsed.video_script)) {
      throw new Error("Resposta da IA não contém video_script válido");
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("adapt-script error:", e);
    const status = e?.status || 500;
    const message = e?.message || (e instanceof Error ? e.message : "Erro desconhecido");
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
