import type { Alignment, Segment } from '@/types/atlas';

export function findSegmentCutPoints(rawText: string, alignment: Alignment, segments: Segment[]): number[] {
  if (segments.length <= 1) return [];

  const cutPoints: number[] = [];
  const alignText = alignment.characters.join('');

  for (let i = 0; i < segments.length - 1; i++) {
    const nextNarration = segments[i + 1].narration;
    const cutTime = findCutTimeForSegment(rawText, alignText, alignment, nextNarration);
    cutPoints.push(cutTime);
  }

  // Ensure cut points are monotonically increasing
  for (let i = 1; i < cutPoints.length; i++) {
    if (cutPoints[i] <= cutPoints[i - 1]) {
      cutPoints[i] = cutPoints[i - 1] + 0.1;
    }
  }

  return cutPoints;
}

function findCutTimeForSegment(rawText: string, alignText: string, alignment: Alignment, narration: string): number {
  // Strategy 1: Direct search in alignment text
  const cleanNarration = narration.trim().toLowerCase();
  const cleanAlignText = alignText.toLowerCase();
  const firstWords = cleanNarration.split(/\s+/).slice(0, 5).join(' ');

  let idx = cleanAlignText.indexOf(firstWords);
  if (idx >= 0 && idx < alignment.character_start_times_seconds.length) {
    return alignment.character_start_times_seconds[idx];
  }

  // Try with first 3 words
  const first3 = cleanNarration.split(/\s+/).slice(0, 3).join(' ');
  idx = cleanAlignText.indexOf(first3);
  if (idx >= 0 && idx < alignment.character_start_times_seconds.length) {
    return alignment.character_start_times_seconds[idx];
  }

  // Strategy 2: Proportional mapping via raw text
  const cleanRaw = rawText.toLowerCase();
  const rawIdx = cleanRaw.indexOf(first3);
  if (rawIdx >= 0) {
    const proportion = rawIdx / cleanRaw.length;
    const alignIdx = Math.floor(proportion * alignment.characters.length);
    if (alignIdx < alignment.character_start_times_seconds.length) {
      return alignment.character_start_times_seconds[alignIdx];
    }
  }

  // Fallback: proportional by segment index (should rarely happen)
  const lastTime = alignment.character_end_times_seconds[alignment.character_end_times_seconds.length - 1] || 0;
  return lastTime * 0.5;
}
