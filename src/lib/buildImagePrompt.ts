/**
 * Replica exatamente a lógica de montagem de prompt da edge function generate-image.
 * Use para gerar prompts prontos para colar no Gemini manualmente.
 */

const STYLE_PROMPTS: Record<string, string> = {
  sketch: `Ilustração desenhada à mão em papel bege/creme texturizado, estilo esboço com hachura a lápis e ligeira aspereza. Paleta: tons de preto, branco e cinza com APENAS laranja como cor de destaque para ênfase. Parece desenhado à mão com lápis no papel. Estilo ilustração educacional.`,
  impacto: `Ilustração CARTOON/QUADRINHO com texturas de meio-tom (halftone) e sombreamento pop-art retrô. Paleta QUENTE e RICA: âmbar, laranja, azul/teal, marrom, verde terroso. Vibrante e quente como quadrinho (NUNCA neon, NUNCA pastel). Alto contraste dramático.`,
};

const DEFAULT_STYLE = `Ilustração desenhada à mão em papel bege/creme texturizado, estilo esboço com hachura a lápis. Tons de cinza com APENAS azul (#4A90E2) como cor de destaque. Estilo ilustração educacional.`;

const CAMERA_ANGLES: Record<string, string> = {
  opening: 'Use PLANO MÉDIO: mostre pessoa ou elemento principal interagindo com o ambiente.',
  middle:  'Use CLOSE-UP/MACRO: foco em um único objeto, número ou símbolo-chave que represente esse momento.',
  closing: 'Use VISÃO AMPLA/CONCEITUAL: metáfora panorâmica, consequência sistêmica ou visão de conjunto.',
  final:   'Use PERSPECTIVA CRIATIVA: ângulo alternativo inesperado, composição diferente de tudo que veio antes.',
};

const POS_LABELS: Record<string, string> = {
  opening: 'ABERTURA',
  middle:  'MEIO',
  closing: 'FECHAMENTO',
  final:   'FINAL',
};

function detectVisualFocus(narration: string): string {
  const lower = narration.toLowerCase();
  if (/dias?|semanas?|meses?|anos?|prazo|tempo|calendário/.test(lower))
    return 'FOCO VISUAL: Mostre passagem do tempo — calendário, relógio ou linha do tempo como metáfora central.';
  if (/por cento|%|porcentagem|crescimento|número|dado|estatística/.test(lower))
    return 'FOCO VISUAL: Mostre dado numérico — gráfico, barra de progresso ou fatia de pizza.';
  if (/erro|armadilha|ilusão|engano|perigo|cuidado|atenção/.test(lower))
    return 'FOCO VISUAL: Mostre revelação — lupa expondo verdade oculta ou armadilha sendo revelada.';
  if (/soma|total|acumulado|pilha|montanha|resultado|efeito/.test(lower))
    return 'FOCO VISUAL: Mostre acumulação — coisas pequenas formando montanha, efeito bola de neve.';
  if (/transformação|evolução|mudança|antes|depois|virada|muda/.test(lower))
    return 'FOCO VISUAL: Mostre transformação — contraste antes/depois, aura de energia ou linha divisória.';
  if (/comparação|diferença|versus|vs\.?|melhor|pior|escolha/.test(lower))
    return 'FOCO VISUAL: Mostre comparação — dois caminhos, duas opções ou dois resultados lado a lado.';
  if (/pessoa|alguém|ela|ele|trabalhador|profissional|usuário/.test(lower))
    return 'FOCO VISUAL: Mostre perspectiva humana — personagem expressivo representando a situação narrada.';
  return '';
}

export function deriveSubPosition(subIndex: number, total: number): string {
  if (total === 1) return 'opening';
  if (subIndex === 1) return 'opening';
  if (total <= 3) return subIndex === total ? 'closing' : 'middle';
  return subIndex === total ? 'final' : 'middle';
}

export interface BuildImagePromptParams {
  imagePrompt: string;
  narration?: string;
  styleName?: string;
  subIndex?: number;
  totalSubScenes?: number;
}

export function buildImagePrompt({
  imagePrompt,
  narration = '',
  styleName = '',
  subIndex,
  totalSubScenes,
}: BuildImagePromptParams): string {
  const activeStyle = STYLE_PROMPTS[styleName] ?? DEFAULT_STYLE;

  const subPosition = (subIndex != null && totalSubScenes != null)
    ? deriveSubPosition(subIndex, totalSubScenes)
    : '';

  const cameraAngle = subPosition ? (CAMERA_ANGLES[subPosition] ?? '') : '';
  const visualFocus = narration ? detectVisualFocus(narration) : '';

  const subSceneLabel = (subPosition && totalSubScenes && totalSubScenes > 1)
    ? `[${POS_LABELS[subPosition] ?? subPosition.toUpperCase()} — sub-cena ${subIndex} de ${totalSubScenes}] `
    : '';

  return [
    'REQUISITO ABSOLUTO: Proporção exata 16:9 (1920x1080 widescreen).',
    'REGRA CRÍTICA DE IDIOMA: TODO texto visível DEVE estar em Português Brasileiro (PT-BR). NUNCA use texto em inglês.',
    'REGRA ANTI-NARRAÇÃO: NUNCA transcreva frases completas da narração na imagem. Máximo 1-4 palavras visíveis (títulos, rótulos, valores numéricos apenas).',
    'REGRA DE ACRÔNIMOS: Use a forma abreviada correta dos acrônimos, nunca soletrados foneticamente.',
    'REGRA DE COMPOSIÇÃO: Elemento principal centralizado ocupando 60-70% do frame. Contexto de suporte nas bordas.',
    `ESTILO: ${activeStyle}`,
    'NUNCA inclua nomes de marcas, canais ou logos.',
    visualFocus,
    cameraAngle,
    `${subSceneLabel}Cena: ${imagePrompt}`,
  ].filter(Boolean).join('\n');
}

export const STYLE_OPTIONS = [
  { value: 'padrao', label: 'Padrão (educacional azul)' },
  { value: 'sketch', label: 'Sketch (esboço laranja)' },
  { value: 'impacto', label: 'Impacto (cartoon retrô)' },
];
