import type { Alignment, Segment, SubScene } from '@/types/atlas';

/**
 * Find cut points for sub-scenes (1 audio per sub-scene).
 * Flattens all sub-scenes across segments in order, then finds
 * the alignment time where each sub-scene's narration starts.
 */
export function findSubSceneCutPoints(
  rawText: string,
  alignment: Alignment,
  segments: Segment[]
): number[] {
  const allSubScenes: SubScene[] = segments
    .sort((a, b) => a.sequence_number - b.sequence_number)
    .flatMap(s => (s.sub_scenes || []).sort((a, b) => a.sub_index - b.sub_index));

  if (allSubScenes.length <= 1) return [];

  const cutPoints: number[] = [];
  const alignText = alignment.characters.join('');

  for (let i = 1; i < allSubScenes.length; i++) {
    const narration = allSubScenes[i].narration_segment;
    const cutTime = findCutTimeForText(rawText, alignText, alignment, narration);
    cutPoints.push(cutTime);
  }

  // Ensure monotonically increasing
  for (let i = 1; i < cutPoints.length; i++) {
    if (cutPoints[i] <= cutPoints[i - 1]) {
      cutPoints[i] = cutPoints[i - 1] + 0.1;
    }
  }

  // Enforce minimum 5s gap between cuts — merge if too close
  const MIN_GAP_SECONDS = 5;
  const filtered: number[] = [cutPoints[0]];
  for (let i = 1; i < cutPoints.length; i++) {
    if (cutPoints[i] - filtered[filtered.length - 1] >= MIN_GAP_SECONDS) {
      filtered.push(cutPoints[i]);
    }
    // else: skip this cut point (merge sub-scenes)
  }

  // Also ensure first cut is at least 5s from start
  if (filtered.length > 0 && filtered[0] < MIN_GAP_SECONDS) {
    filtered.shift();
  }

  return filtered;
}

/** @deprecated Use findSubSceneCutPoints instead */
export function findSegmentCutPoints(rawText: string, alignment: Alignment, segments: Segment[]): number[] {
  if (segments.length <= 1) return [];

  const cutPoints: number[] = [];
  const alignText = alignment.characters.join('');

  for (let i = 0; i < segments.length - 1; i++) {
    const nextNarration = segments[i + 1].narration;
    const cutTime = findCutTimeForText(rawText, alignText, alignment, nextNarration);
    cutPoints.push(cutTime);
  }

  for (let i = 1; i < cutPoints.length; i++) {
    if (cutPoints[i] <= cutPoints[i - 1]) {
      cutPoints[i] = cutPoints[i - 1] + 0.1;
    }
  }

  return cutPoints;
}

function findCutTimeForText(rawText: string, alignText: string, alignment: Alignment, narration: string): number {
  const cleanNarration = narration.trim().toLowerCase();
  const cleanAlignText = alignText.toLowerCase();
  const firstWords = cleanNarration.split(/\s+/).slice(0, 5).join(' ');

  let idx = cleanAlignText.indexOf(firstWords);
  if (idx >= 0 && idx < alignment.character_start_times_seconds.length) {
    return alignment.character_start_times_seconds[idx];
  }

  const first3 = cleanNarration.split(/\s+/).slice(0, 3).join(' ');
  idx = cleanAlignText.indexOf(first3);
  if (idx >= 0 && idx < alignment.character_start_times_seconds.length) {
    return alignment.character_start_times_seconds[idx];
  }

  const cleanRaw = rawText.toLowerCase();
  const rawIdx = cleanRaw.indexOf(first3);
  if (rawIdx >= 0) {
    const proportion = rawIdx / cleanRaw.length;
    const alignIdx = Math.floor(proportion * alignment.characters.length);
    if (alignIdx < alignment.character_start_times_seconds.length) {
      return alignment.character_start_times_seconds[alignIdx];
    }
  }

  const lastTime = alignment.character_end_times_seconds[alignment.character_end_times_seconds.length - 1] || 0;
  return lastTime * 0.5;
}
