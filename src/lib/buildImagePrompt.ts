/**
 * Monta um prompt de geração de imagem no estilo art direction —
 * parágrafo coeso, não lista de regras — para uso manual no Gemini
 * ou via API (generate-image).
 */

const STYLE_DESCRIPTIONS: Record<string, string> = {
  sketch: 'desenhada à mão em papel bege texturizado, estilo esboço com hachura a lápis e ligeira aspereza, usando tons de preto, branco e cinza, com apenas laranja como cor de destaque para ênfase',
  impacto: 'no estilo cartoon/quadrinho com texturas de meio-tom (halftone) e sombreamento pop-art retrô, paleta quente e rica com âmbar, laranja, azul-teal e marrom, alto contraste dramático',
};

const DEFAULT_STYLE_DESC = 'desenhada à mão em papel bege texturizado, estilo esboço com hachura a lápis, usando tons de cinza com apenas azul (#4A90E2) como cor de destaque para ênfase';

const CAMERA_INSTRUCTIONS: Record<string, string> = {
  opening: 'O enquadramento usa PLANO MÉDIO, mostrando a pessoa ou elemento principal interagindo com o ambiente.',
  middle:  'O enquadramento usa CLOSE-UP, com foco em um único objeto, número ou símbolo-chave que represente esse momento.',
  closing: 'O enquadramento usa VISÃO AMPLA, com uma metáfora panorâmica ou visão de conjunto que sintetize o bloco.',
  final:   'O enquadramento usa PERSPECTIVA CRIATIVA, com composição diferente de tudo que veio antes.',
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
    return 'Elementos de passagem do tempo (calendário, relógio ou linha do tempo) reforçam a ideia central.';
  if (/por cento|%|porcentagem|crescimento|número|dado|estatística/.test(lower))
    return 'Um dado numérico (gráfico de barras, barra de progresso ou fatia de pizza) é o destaque visual.';
  if (/erro|armadilha|ilusão|engano|perigo|cuidado|atenção/.test(lower))
    return 'Uma lupa expondo uma verdade oculta ou uma armadilha sendo revelada reforça a mensagem.';
  if (/soma|total|acumulado|pilha|montanha|resultado|efeito/.test(lower))
    return 'Elementos pequenos se acumulando em montanha ou efeito bola de neve reforçam a ideia.';
  if (/transformação|evolução|mudança|antes|depois|virada/.test(lower))
    return 'Um contraste antes/depois ou linha divisória de transformação reforça a mensagem visual.';
  if (/comparação|diferença|versus|vs\.?|melhor|pior|escolha/.test(lower))
    return 'Dois caminhos, opções ou resultados lado a lado criam a comparação visual.';
  if (/pessoa|alguém|ela|ele|trabalhador|profissional|estudante/.test(lower))
    return 'Um personagem expressivo representando a situação narrada ocupa posição de destaque.';
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
  const styleDesc = STYLE_DESCRIPTIONS[styleName] ?? DEFAULT_STYLE_DESC;

  const subPosition = (subIndex != null && totalSubScenes != null)
    ? deriveSubPosition(subIndex, totalSubScenes)
    : 'opening';

  const cameraInstruction = CAMERA_INSTRUCTIONS[subPosition] ?? '';
  const visualHint = narration ? detectVisualHint(narration) : '';

  const posLabel = subIndex != null && totalSubScenes != null && totalSubScenes > 1
    ? `[${POS_LABELS[subPosition] ?? subPosition.toUpperCase()} — sub-cena ${subIndex} de ${totalSubScenes}] `
    : '';

  // Monta parágrafo coeso de art direction
  const parts: string[] = [
    `Uma ilustração educacional ${styleDesc}.`,
    `${posLabel}${imagePrompt}.`,
    cameraInstruction,
    visualHint ? `${visualHint}` : '',
    'O elemento principal está centralizado e ocupa 60-70% do frame, com contexto de suporte nas bordas.',
    'Todo texto visível na imagem deve estar em Português Brasileiro (PT-BR), com no máximo 1-4 palavras visíveis (títulos, rótulos ou valores numéricos — nunca frases completas da narração).',
    'O fundo mantém a textura do papel com leves linhas de esboço de contexto, sem logotipos ou marcas.',
    'Proporção exata 16:9 (1920x1080 widescreen).',
  ];

  return parts.filter(p => p.trim().length > 0).join(' ');
}

export const STYLE_OPTIONS = [
  { value: 'padrao', label: 'Padrão (educacional azul)' },
  { value: 'sketch', label: 'Sketch (esboço laranja)' },
  { value: 'impacto', label: 'Impacto (cartoon retrô)' },
];
