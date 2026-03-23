/**
 * Splits a segment's narration into 1-4 sub-scenes based on word count.
 * Each sub-scene gets a portion of the narration and a variation of the image prompt.
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

export function splitIntoSubScenes(
  narration: string,
  baseImagePrompt: string | null
): SubSceneInput[] {
  const words = narration.trim().split(/\s+/);
  const wordCount = words.length;

  let numSubScenes: number;
  if (wordCount < 25) numSubScenes = 1;
  else if (wordCount < 50) numSubScenes = 2;
  else if (wordCount < 75) numSubScenes = 3;
  else numSubScenes = 4;

  // Split narration into sentences, then distribute among sub-scenes
  const sentences = narration.match(/[^.!?]+[.!?]*/g) || [narration];
  const subScenes: SubSceneInput[] = [];

  // Distribute sentences evenly
  const perSubScene = Math.ceil(sentences.length / numSubScenes);

  for (let i = 0; i < numSubScenes; i++) {
    const start = i * perSubScene;
    const end = Math.min(start + perSubScene, sentences.length);
    const chunk = sentences.slice(start, end).join(' ').trim();

    if (!chunk) continue;

    const prompt = baseImagePrompt
      ? `${baseImagePrompt} — ${PERSPECTIVE_HINTS[i]}`
      : null;

    subScenes.push({
      sub_index: i + 1,
      narration_segment: chunk,
      image_prompt: prompt,
    });
  }

  // Ensure at least 1 sub-scene
  if (subScenes.length === 0) {
    subScenes.push({
      sub_index: 1,
      narration_segment: narration,
      image_prompt: baseImagePrompt,
    });
  }

  return subScenes;
}
