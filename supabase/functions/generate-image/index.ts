import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TIMEOUT_MS = 55_000;
const PRIMARY_MODEL = "gemini-3-pro-image-preview";
const FALLBACK_MODEL = "gemini-3.1-flash-image-preview";

// Paletas de estilo fixas — garantem consistência visual em todo o vídeo
const STYLE_PROMPTS: Record<string, string> = {
  sketch: `Ilustração desenhada à mão em papel bege/creme texturizado, estilo esboço com hachura a lápis e ligeira aspereza. Paleta: tons de preto, branco e cinza com APENAS laranja como cor de destaque para ênfase. Parece desenhado à mão com lápis no papel. Estilo ilustração educacional.`,
  impacto: `Ilustração CARTOON/QUADRINHO com texturas de meio-tom (halftone) e sombreamento pop-art retrô. Paleta QUENTE e RICA: âmbar, laranja, azul/teal, marrom, verde terroso. Vibrante e quente como quadrinho (NUNCA neon, NUNCA pastel). Alto contraste dramático.`,
};

const DEFAULT_STYLE = `Ilustração desenhada à mão em papel bege/creme texturizado, estilo esboço com hachura a lápis. Tons de cinza com APENAS azul (#4A90E2) como cor de destaque. Estilo ilustração educacional.`;

// Rotação de ângulo de câmera por posição da sub-cena
const CAMERA_ANGLES: Record<string, string> = {
  opening: "Use PLANO MÉDIO: mostre pessoa ou elemento principal interagindo com o ambiente.",
  middle:  "Use CLOSE-UP/MACRO: foco em um único objeto, número ou símbolo-chave que represente esse momento.",
  closing: "Use VISÃO AMPLA/CONCEITUAL: metáfora panorâmica, consequência sistêmica ou visão de conjunto.",
  final:   "Use PERSPECTIVA CRIATIVA: ângulo alternativo inesperado, composição diferente de tudo que veio antes.",
};

// Detecta foco visual a partir de palavras-chave na narração
function detectVisualFocus(narration: string): string {
  const lower = narration.toLowerCase();
  if (/dias?|semanas?|meses?|anos?|prazo|tempo|calendário/.test(lower))
    return "FOCO VISUAL: Mostre passagem do tempo — calendário, relógio ou linha do tempo como metáfora central.";
  if (/por cento|%|porcentagem|crescimento|número|dado|estatística/.test(lower))
    return "FOCO VISUAL: Mostre dado numérico — gráfico, barra de progresso ou fatia de pizza.";
  if (/erro|armadilha|ilusão|engano|perigo|cuidado|atenção/.test(lower))
    return "FOCO VISUAL: Mostre revelação — lupa expondo verdade oculta ou armadilha sendo revelada.";
  if (/soma|total|acumulado|pilha|montanha|resultado|efeito/.test(lower))
    return "FOCO VISUAL: Mostre acumulação — coisas pequenas formando montanha, efeito bola de neve.";
  if (/transformação|evolução|mudança|antes|depois|virada|muda/.test(lower))
    return "FOCO VISUAL: Mostre transformação — contraste antes/depois, aura de energia ou linha divisória.";
  if (/comparação|diferença|versus|vs\.?|melhor|pior|escolha/.test(lower))
    return "FOCO VISUAL: Mostre comparação — dois caminhos, duas opções ou dois resultados lado a lado.";
  if (/pessoa|alguém|ela|ele|trabalhador|profissional|usuário/.test(lower))
    return "FOCO VISUAL: Mostre perspectiva humana — personagem expressivo representando a situação narrada.";
  return "";
}

function extractBase64FromResponse(result: any): string | undefined {
  const message = result.choices?.[0]?.message;
  const images = message?.images;

  if (images && images.length > 0) {
    const imageDataUrl = images[0].image_url?.url || images[0];
    return typeof imageDataUrl === 'string' && imageDataUrl.includes(',')
      ? imageDataUrl.split(",")[1]
      : imageDataUrl;
  }

  if (message?.content && Array.isArray(message.content)) {
    const imagePart = message.content.find((p: any) => p.type === 'image_url' || p.type === 'image');
    if (imagePart) {
      const url = imagePart.image_url?.url || imagePart.url;
      return url?.includes(',') ? url.split(",")[1] : url;
    }
  }

  return undefined;
}

async function fetchAssetAsBase64(url: string): Promise<{ b64: string; contentType: string } | null> {
  try {
    const imgRes = await fetch(url);
    if (!imgRes.ok) { console.warn(`Failed to fetch asset image: ${url}`); return null; }
    const buf = await imgRes.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const contentType = imgRes.headers.get('content-type') || 'image/png';
    console.log(`Asset image loaded: ${url.slice(-40)} (${bytes.length} bytes)`);
    return { b64, contentType };
  } catch (e) {
    console.warn(`Error fetching asset image ${url}:`, e);
    return null;
  }
}

async function callImageAIWithFallback(
  apiKey: string,
  contentParts: any[],
): Promise<any> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      console.log(`Trying image model: ${model}`);
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: contentParts }],
          modalities: ["image", "text"],
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 429) throw { status: 429, message: "Rate limited — please try again in a moment" };
      if (response.status === 402) throw { status: 402, message: "AI credits exhausted — please add funds in Settings > Workspace > Usage" };
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI Gateway error [${response.status}]: ${errText.slice(0, 500)}`);
      }

      const responseText = await response.text();
      if (responseText.trimStart().startsWith('<')) {
        throw new Error(`AI Gateway returned HTML instead of JSON (likely temporary error). Response: ${responseText.slice(0, 200)}`);
      }

      let result: any;
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(`AI Gateway returned invalid JSON: ${responseText.slice(0, 200)}`);
      }

      // Check for embedded errors (429/rate-limit returned inside a 200 response)
      const choiceError = result.choices?.[0]?.error;
      if (choiceError) {
        const code = choiceError.code || choiceError.status;
        const errType = choiceError.metadata?.error_type || '';
        if (code === 429 || errType === 'rate_limit_exceeded') {
          console.warn(`Embedded 429 in response from ${model}, trying fallback...`);
          throw new Error("Embedded rate limit in response");
        }
        console.warn(`Embedded error in response from ${model}: ${JSON.stringify(choiceError)}`);
        throw new Error(`Embedded error: ${choiceError.message || 'unknown'}`);
      }

      const base64Data = extractBase64FromResponse(result);
      if (!base64Data) {
        console.error("No image in response:", JSON.stringify(result).slice(0, 2000));
        throw new Error("No image generated by model");
      }

      return base64Data;
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.status === 429 || e?.status === 402) throw e;
      if (i === models.length - 1) throw e;
      console.warn(`Model ${model} failed, trying fallback:`, e.message || e);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      imagePrompt, narration, projectId, segmentId, sequenceNumber,
      subIndex, subPosition, totalSubScenes, alreadyIllustrated,
      momentType, styleName, stylePrefix,
      assetDescriptions, assetImageUrls,
    } = await req.json();

    if (!imagePrompt || !projectId) throw new Error("imagePrompt and projectId required");

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Determinar estilo ativo: nome fixo > stylePrefix do DB > padrão
    const activeStyle = (styleName && STYLE_PROMPTS[styleName])
      ? STYLE_PROMPTS[styleName]
      : (stylePrefix || DEFAULT_STYLE);

    // Bloco de referências de asset/personagem
    let assetBlock = '';
    if (assetDescriptions && Array.isArray(assetDescriptions) && assetDescriptions.length > 0) {
      const assetLines = assetDescriptions.map(
        (a: { name: string; description: string; category?: string }) =>
          `- ${a.name}: ${a.description}`
      ).join('\n');
      assetBlock = `\nREFERÊNCIAS VISUAIS (personagens/assets):\n${assetLines}\nIMPORTANTE: Desenhe-os exatamente como nas imagens de referência — mantendo rosto, cabelo e estilo de roupa. Inclua-os apenas quando fizer sentido visual para o conteúdo.\n`;
    }

    // Bloco de ângulo de câmera por posição da sub-cena
    const cameraAngle = subPosition
      ? (CAMERA_ANGLES[subPosition] || '')
      : '';

    // Foco visual por palavra-chave na narração
    const visualFocus = narration ? detectVisualFocus(narration) : '';

    // Bloco de anti-repetição
    let antiRepetitionBlock = '';
    if (alreadyIllustrated && Array.isArray(alreadyIllustrated) && alreadyIllustrated.length > 0) {
      antiRepetitionBlock = `\nJÁ ILUSTRADO — NÃO REPETIR: ${alreadyIllustrated.join('; ')}.\nREGRA DE VARIAÇÃO OBRIGATÓRIA: Use composição, enquadramento e metáfora visual COMPLETAMENTE DIFERENTES das sub-cenas anteriores. NUNCA repita o elemento central de uma imagem anterior.\n`;
    }

    // Label de posição da sub-cena
    const posLabels: Record<string, string> = { opening: 'ABERTURA', middle: 'MEIO', closing: 'FECHAMENTO', final: 'FINAL' };
    const subSceneLabel = (subPosition && totalSubScenes > 1)
      ? `[${posLabels[subPosition] || subPosition.toUpperCase()} — sub-cena ${subIndex} de ${totalSubScenes}] `
      : '';

    // Build the text prompt — always single image mode
    const textPrompt = `REQUISITO ABSOLUTO: Proporção exata 16:9 (1920x1080 widescreen).
REGRA CRÍTICA DE IDIOMA: TODO texto visível DEVE estar em Português Brasileiro (PT-BR). NUNCA use texto em inglês.
REGRA ANTI-NARRAÇÃO: NUNCA transcreva frases completas da narração na imagem. Máximo 1-4 palavras visíveis (títulos, rótulos, valores numéricos apenas).
REGRA DE ACRÔNIMOS: Use a forma abreviada correta dos acrônimos, nunca soletrados foneticamente.
REGRA DE COMPOSIÇÃO: Elemento principal centralizado ocupando 60-70% do frame. Contexto de suporte nas bordas.
ESTILO: ${activeStyle}
NUNCA inclua nomes de marcas, canais ou logos.
${assetBlock}
${antiRepetitionBlock}
${visualFocus ? visualFocus + '\n' : ''}
${cameraAngle ? cameraAngle + '\n' : ''}
${subSceneLabel}Cena: ${imagePrompt}`;

    // Build multimodal content parts
    const contentParts: any[] = [{ type: "text", text: textPrompt }];

    // Fetch asset images as base64 inline data
    if (assetImageUrls && Array.isArray(assetImageUrls)) {
      const urls = assetImageUrls.filter((u: unknown) => u && typeof u === 'string').slice(0, 8);
      for (const url of urls) {
        const result = await fetchAssetAsBase64(url as string);
        if (result) {
          contentParts.push({
            type: "image_url",
            image_url: { url: `data:${result.contentType};base64,${result.b64}` },
          });
        }
      }
    }

    // Call AI with fallback
    const base64Data = await callImageAIWithFallback(GOOGLE_AI_API_KEY, contentParts);

    const imageBytes = base64Decode(base64Data);
    const num = String(sequenceNumber).padStart(3, "0");
    const subSuffix = subIndex ? `-sub-${subIndex}` : "";
    const fileName = `${projectId}/segment-${num}${subSuffix}.png`;

    const { error: uploadErr } = await supabase.storage
      .from("segment-images")
      .upload(fileName, imageBytes, { upsert: true, contentType: "image/png" });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from("segment-images").getPublicUrl(fileName);

    return new Response(JSON.stringify({
      imageUrl: urlData.publicUrl + `?t=${Date.now()}`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-image error:", e);
    const status = e?.status || 500;
    const message = e?.message || (e instanceof Error ? e.message : "Unknown error");
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
