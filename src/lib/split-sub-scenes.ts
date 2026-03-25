/**
 * Splits a segment's narration into sub-scenes of 10-20 words each (~4-8 seconds).
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
  'vista lateral, composição dinâmica',
  'plano médio, destaque no elemento central',
  'ângulo superior, visão de contexto',
  'composição diagonal, perspectiva dramática',
];

const TARGET_WORDS = 15;
const MIN_WORDS = 10;
const MAX_WORDS = 20;

export function splitIntoSubScenes(
  narration: string,
  baseImagePrompt: string | null
): SubSceneInput[] {
  const words = narration.trim().split(/\s+/);
  const wordCount = words.length;

  // Calculate ideal number of sub-scenes
  let numSubScenes = Math.max(1, Math.round(wordCount / TARGET_WORDS));

  // Split narration into sentences, then distribute among sub-scenes
  const sentences = narration.match(/[^.!?]+[.!?]*/g) || [narration];
  let subScenes: SubSceneInput[] = [];

  // Distribute sentences evenly
  const perSubScene = Math.ceil(sentences.length / numSubScenes);

  for (let i = 0; i < numSubScenes; i++) {
    const start = i * perSubScene;
    const end = Math.min(start + perSubScene, sentences.length);
    const chunk = sentences.slice(start, end).join(' ').trim();
    if (!chunk) continue;

    subScenes.push({
      sub_index: i + 1,
      narration_segment: chunk,
      image_prompt: null,
    });
  }

  // Merge sub-scenes that are too short (< MIN_WORDS)
  for (let i = subScenes.length - 1; i > 0; i--) {
    const sceneWords = subScenes[i].narration_segment.trim().split(/\s+/).length;
    if (sceneWords < MIN_WORDS) {
      subScenes[i - 1].narration_segment += ' ' + subScenes[i].narration_segment;
      subScenes.splice(i, 1);
    }
  }

  // Split sub-scenes that are too long (> MAX_WORDS)
  const expanded: SubSceneInput[] = [];
  for (const scene of subScenes) {
    const sceneWords = scene.narration_segment.trim().split(/\s+/);
    if (sceneWords.length > MAX_WORDS) {
      const parts = Math.ceil(sceneWords.length / TARGET_WORDS);
      const perPart = Math.ceil(sceneWords.length / parts);
      for (let j = 0; j < parts; j++) {
        const partWords = sceneWords.slice(j * perPart, (j + 1) * perPart);
        if (partWords.length > 0) {
          expanded.push({
            sub_index: 0,
            narration_segment: partWords.join(' '),
            image_prompt: null,
          });
        }
      }
    } else {
      expanded.push(scene);
    }
  }
  subScenes = expanded;

  // Re-index and assign prompts cyclically
  subScenes.forEach((s, idx) => {
    s.sub_index = idx + 1;
    s.image_prompt = baseImagePrompt
      ? `${baseImagePrompt} — ${PERSPECTIVE_HINTS[idx % PERSPECTIVE_HINTS.length]}`
      : null;
  });

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
