/**
 * Splits a segment's narration into sub-scenes based on word count and moment type.
 * CTA and hook segments get max 1 sub-scene.
 * Other types follow word-count-based splitting (target 7-10s per sub-scene).
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

// Moment types that should NEVER be split into multiple sub-scenes
const SINGLE_SUB_SCENE_TYPES = new Set(['cta', 'hook']);

function getTargetSubSceneCount(wordCount: number, momentType?: string | null, maxSubScenes?: number | null): number {
  // CTA and hook always get 1 sub-scene
  if (momentType && SINGLE_SUB_SCENE_TYPES.has(momentType)) return 1;
  
  // If the AI suggested a max, respect it (clamped to 1-4)
  if (maxSubScenes != null && maxSubScenes >= 1) {
    return Math.min(maxSubScenes, MAX_SUB_SCENES);
  }

  // Default word-count-based logic
  if (wordCount < 25) return 1;
  if (wordCount < 50) return 2;
  if (wordCount < 75) return 3;
  return MAX_SUB_SCENES;
}

export function splitIntoSubScenes(
  narration: string,
  baseImagePrompt: string | null,
  momentType?: string | null,
  maxSubScenes?: number | null
): SubSceneInput[] {
  const words = narration.trim().split(/\s+/);
  const wordCount = words.length;
  const numSubScenes = getTargetSubSceneCount(wordCount, momentType, maxSubScenes);

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

  if (subScenes.length === 0) {
    subScenes.push({
      sub_index: 1,
      narration_segment: narration.trim(),
      image_prompt: baseImagePrompt,
    });
  }

  return subScenes;
}
