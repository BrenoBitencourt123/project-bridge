/**
 * Splits a segment's narration into sub-scenes based on word count ranges.
 * Aligned with Atlas-new-creators reference:
 * < 25 words → 1 sub-scene
 * < 50 words → 2 sub-scenes
 * < 75 words → 3 sub-scenes
 * >= 75 words → 4 sub-scenes (MAX)
 */
export interface SubSceneInput {
  sub_index: number;
  narration_segment: string;
  image_prompt: string | null;
}

const PERSPECTIVE_HINTS = [
  'vista frontal, foco no conceito principal',
  'close-up detalhado, ângulo diferente',
  'visão panorâmica, contexto amplo',
  'perspectiva criativa, ângulo alternativo',
];

const MAX_SUB_SCENES = 4;

function getTargetSubSceneCount(wordCount: number): number {
  if (wordCount < 25) return 1;
  if (wordCount < 50) return 2;
  if (wordCount < 75) return 3;
  return MAX_SUB_SCENES;
}

export function splitIntoSubScenes(
  narration: string,
  baseImagePrompt: string | null
): SubSceneInput[] {
  const words = narration.trim().split(/\s+/);
  const wordCount = words.length;
  const numSubScenes = getTargetSubSceneCount(wordCount);

  if (numSubScenes === 1) {
    return [{
      sub_index: 1,
      narration_segment: narration.trim(),
      image_prompt: baseImagePrompt
        ? `${baseImagePrompt} — ${PERSPECTIVE_HINTS[0]}`
        : null,
    }];
  }

  // Split by sentences then distribute
  const sentences = narration.match(/[^.!?]+[.!?]*/g) || [narration];
  const subScenes: SubSceneInput[] = [];
  const perSubScene = Math.ceil(sentences.length / numSubScenes);

  for (let i = 0; i < numSubScenes; i++) {
    const start = i * perSubScene;
    const end = Math.min(start + perSubScene, sentences.length);
    const chunk = sentences.slice(start, end).join(' ').trim();
    if (!chunk) continue;

    subScenes.push({
      sub_index: i + 1,
      narration_segment: chunk,
      image_prompt: baseImagePrompt
        ? `${baseImagePrompt} — ${PERSPECTIVE_HINTS[i % PERSPECTIVE_HINTS.length]}`
        : null,
    });
  }

  // If we got fewer sub-scenes than sentences allowed, ensure at least 1
  if (subScenes.length === 0) {
    subScenes.push({
      sub_index: 1,
      narration_segment: narration.trim(),
      image_prompt: baseImagePrompt,
    });
  }

  return subScenes;
}
