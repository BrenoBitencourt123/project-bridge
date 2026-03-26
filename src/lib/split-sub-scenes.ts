/**
 * Divide a narração de um segmento em sub-cenas com base no total de palavras.
 * Thresholds: < 25 → 1, 25-49 → 2, 50-74 → 3, 75+ → 4 sub-cenas.
 * Cada sub-cena recebe uma posição (OPENING/MIDDLE/CLOSING/FINAL) e ângulo de câmera.
 */
export interface SubSceneInput {
  sub_index: number;
  narration_segment: string;
  image_prompt: string | null;
}

type SubPosition = 'OPENING' | 'MIDDLE' | 'CLOSING' | 'FINAL';

const CAMERA_ANGLES: Record<SubPosition, string> = {
  OPENING: 'plano médio, apresentação do conceito',
  MIDDLE:  'close-up detalhado, foco no desenvolvimento',
  CLOSING: 'plano geral, síntese visual',
  FINAL:   'plano panorâmico, conclusão ampla',
};

function getSubSceneCount(wordCount: number): number {
  if (wordCount < 30) return 1;
  if (wordCount < 55) return 2;
  if (wordCount < 80) return 3;
  if (wordCount < 110) return 4;
  return 5;
}

function derivePosition(subIndex: number, total: number): SubPosition {
  if (total === 1) return 'OPENING';
  if (subIndex === 1) return 'OPENING';
  if (total <= 3) return subIndex === total ? 'CLOSING' : 'MIDDLE';
  return subIndex === total ? 'FINAL' : 'MIDDLE';
}

function distributeProportionally(sentences: string[], count: number): string[] {
  if (count === 1) return [sentences.join(' ')];
  const groups: string[] = [];
  const perGroup = Math.ceil(sentences.length / count);
  for (let i = 0; i < count; i++) {
    const chunk = sentences.slice(i * perGroup, (i + 1) * perGroup);
    if (chunk.length > 0) groups.push(chunk.join(' '));
  }
  return groups;
}

export function splitIntoSubScenes(
  narration: string,
  baseImagePrompt: string | null,
  _momentType?: string | null,
  _maxSubScenes?: number | null // ignorado — thresholds de palavras são mais confiáveis
): SubSceneInput[] {
  const wordCount = narration.trim().split(/\s+/).length;
  const count = getSubSceneCount(wordCount);

  // 1 sub-cena → retorna direto sem dividir
  if (count === 1) {
    return [{
      sub_index: 1,
      narration_segment: narration.trim(),
      image_prompt: null,
    }];
  }

  // Divide em frases usando lookbehind para não cortar abreviações
  const sentences = narration
    .split(/(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  // Fallback: sem frases identificáveis → narração inteira como 1 sub-cena
  if (sentences.length === 0) {
    return [{
      sub_index: 1,
      narration_segment: narration.trim(),
      image_prompt: null,
    }];
  }

  const chunks = distributeProportionally(sentences, count);
  const total = chunks.length;

  return chunks.map((chunk, i) => {
    return {
      sub_index: i + 1,
      narration_segment: chunk,
      image_prompt: null,
    };
  });
}
