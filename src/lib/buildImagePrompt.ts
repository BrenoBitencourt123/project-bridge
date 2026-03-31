/**
 * Monta um prompt de geração de imagem com assinatura visual (semente de consistência).
 * O bloco ESTILO MESTRE é sempre o primeiro elemento lido pelo modelo,
 * garantindo que todas as imagens do vídeo mantenham a mesma linguagem visual.
 */

const STYLE_SEEDS: Record<string, string> = {
  sketch: `ESTILO MESTRE (aplique em todos os elementos): Ilustração desenhada à mão, estilo esboço educacional, papel bege/creme texturizado (#E8E0D0). Paleta restrita: preto, branco e cinza (#2C2C2C traços) com APENAS laranja (#E8610A) como cor de destaque — use o laranja somente para o elemento mais importante da cena. Técnica: hachura a lápis, ligeira aspereza, traços irregulares que parecem feitos à mão. Feel: caderno de estudante, anotação de aula, didático e acessível. NUNCA use cores fora desta paleta.`,

  impacto: `ESTILO MESTRE (aplique em todos os elementos): Ilustração cartoon/quadrinho com texturas de meio-tom (halftone) e sombreamento pop-art retrô. Paleta quente e rica: âmbar (#F5A623), laranja (#E8610A), azul-teal (#1A9E9E), marrom (#7B4F2E), verde terroso (#5A7A3A). Técnica: contornos pretos espessos, halftone nas sombras, alto contraste dramático. Feel: quadrinho educacional, energia, impacto visual imediato. NUNCA use neon, NUNCA use pastel, NUNCA use realismo fotográfico.`,

  padrao: `ESTILO MESTRE (aplique em todos os elementos): Ilustração desenhada à mão, estilo esboço educacional clean, papel bege/creme suave (#F5F0E8). Paleta: tons de cinza (#444444 traços) com APENAS azul (#4A90E2) como cor de destaque — use o azul somente para o elemento mais importante da cena. Técnica: hachura leve a lápis, linhas limpas, aspecto de material didático profissional. Feel: startup de educação, clean, moderno e confiável. NUNCA use cores fora desta paleta.`,
};

const CAMERA_INSTRUCTIONS: Record<string, string> = {
  opening: 'Enquadramento: PLANO MÉDIO — mostre a pessoa ou elemento principal interagindo com o ambiente.',
  middle:  'Enquadramento: CLOSE-UP — foco em um único objeto, número ou símbolo-chave que represente esse momento.',
  closing: 'Enquadramento: VISÃO AMPLA — metáfora panorâmica ou visão de conjunto que sintetize o bloco.',
  final:   'Enquadramento: PERSPECTIVA CRIATIVA — composição diferente de tudo que veio antes.',
};

const POS_LABELS: Record<string, string> = {
  opening: 'ABERTURA',
  middle:  'MEIO',
  closing: 'FECHAMENTO',
  final:   'FINAL',
};

function detectVisualHint(narration: string): string {
  const lower = narration.toLowerCase();
  if (/dias?|semanas?|meses?|anos?|prazo|tempo|calendário/.test(lower))
    return 'Dica visual: elementos de passagem do tempo (calendário, relógio ou linha do tempo) como metáfora central.';
  if (/por cento|%|porcentagem|crescimento|número|dado|estatística/.test(lower))
    return 'Dica visual: dado numérico em destaque — gráfico de barras, barra de progresso ou fatia de pizza.';
  if (/erro|armadilha|ilusão|engano|perigo|cuidado|atenção/.test(lower))
    return 'Dica visual: lupa expondo verdade oculta ou armadilha sendo revelada.';
  if (/soma|total|acumulado|pilha|montanha|resultado|efeito/.test(lower))
    return 'Dica visual: elementos pequenos se acumulando — efeito bola de neve ou montanha crescente.';
  if (/transformação|evolução|mudança|antes|depois|virada/.test(lower))
    return 'Dica visual: contraste antes/depois ou linha divisória de transformação.';
  if (/comparação|diferença|versus|vs\.?|melhor|pior|escolha/.test(lower))
    return 'Dica visual: dois caminhos, opções ou resultados lado a lado.';
  if (/pessoa|alguém|ela|ele|trabalhador|profissional|estudante/.test(lower))
    return 'Dica visual: personagem expressivo representando a situação narrada em posição de destaque.';
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
  const styleKey = styleName && STYLE_SEEDS[styleName] ? styleName : 'padrao';
  const styleSeed = STYLE_SEEDS[styleKey];

  const subPosition = (subIndex != null && totalSubScenes != null)
    ? deriveSubPosition(subIndex, totalSubScenes)
    : 'opening';

  const cameraInstruction = CAMERA_INSTRUCTIONS[subPosition] ?? '';
  const visualHint = narration ? detectVisualHint(narration) : '';

  const posLabel = subIndex != null && totalSubScenes != null && totalSubScenes > 1
    ? `[${POS_LABELS[subPosition] ?? subPosition.toUpperCase()} — sub-cena ${subIndex} de ${totalSubScenes}] `
    : '';

  const lines = [
    styleSeed,
    '',
    `CENA: ${posLabel}${imagePrompt}`,
    cameraInstruction,
    visualHint,
    '',
    'COMPOSIÇÃO: Elemento principal centralizado, ocupando 60-70% do frame. Contexto de suporte nas bordas.',
    'TEXTO: Máximo 1-4 palavras visíveis em Português Brasileiro (PT-BR) — títulos ou rótulos curtos. Nunca transcrever frases completas da narração.',
    'FUNDO: Textura do papel do estilo mestre, leves linhas de esboço de contexto. Sem logotipos ou marcas.',
    'PROPORÇÃO: 16:9 exato (1920x1080 widescreen).',
  ];

  return lines.filter(l => l !== undefined && !(l === '' && lines[lines.indexOf(l) - 1] === '')).join('\n');
}

export const STYLE_OPTIONS = [
  { value: 'padrao', label: 'Padrão (educacional azul)' },
  { value: 'sketch', label: 'Sketch (esboço laranja)' },
  { value: 'impacto', label: 'Impacto (cartoon retrô)' },
];
