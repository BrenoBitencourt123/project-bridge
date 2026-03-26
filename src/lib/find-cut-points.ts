import type { Alignment, Segment, SubScene } from '@/types/atlas';

const MIN_GAP_SECONDS = 3.5;

/**
 * Normalize text for fuzzy matching: remove accents, punctuation, lowercase, collapse spaces.
 */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find cut points for sub-scenes (1 audio per sub-scene).
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

  const totalDuration = alignment.character_end_times_seconds[alignment.character_end_times_seconds.length - 1] || 0;
  const normAlignText = normalize(alignment.characters.join(''));

  let lastCharIdx = 0;
  const cutPoints: number[] = [];

  for (let i = 1; i < allSubScenes.length; i++) {
    const narration = allSubScenes[i].narration_segment;
    const cutTime = findCutTimeForText(normAlignText, alignment, narration, lastCharIdx);

    if (cutTime !== null) {
      cutPoints.push(cutTime);
      // Update lastCharIdx to avoid duplicate matches
      const charIdx = findCharIndexForTime(alignment, cutTime);
      if (charIdx > lastCharIdx) lastCharIdx = charIdx;
    } else {
      // Fallback: proportional by word count
      const wordsBefore = allSubScenes.slice(0, i).reduce((sum, s) => sum + countWords(s.narration_segment), 0);
      const totalWords = allSubScenes.reduce((sum, s) => sum + countWords(s.narration_segment), 0);
      cutPoints.push(totalDuration * (wordsBefore / totalWords));
    }
  }

  // Ensure monotonically increasing
  for (let i = 1; i < cutPoints.length; i++) {
    if (cutPoints[i] <= cutPoints[i - 1]) {
      cutPoints[i] = cutPoints[i - 1] + 0.1;
    }
  }

  // Enforce minimum gap of MIN_GAP_SECONDS
  enforceMinGap(cutPoints, totalDuration);

  return cutPoints;
}

/**
 * Enforce minimum gap between consecutive cut points and boundaries (0 and totalDuration).
 */
function enforceMinGap(cutPoints: number[], totalDuration: number): void {
  if (cutPoints.length === 0) return;

  const boundaries = [0, ...cutPoints, totalDuration];
  const numSegments = boundaries.length - 1;
  const totalNeeded = numSegments * MIN_GAP_SECONDS;

  if (totalNeeded > totalDuration) {
    // Not enough time — distribute evenly
    for (let i = 0; i < cutPoints.length; i++) {
      cutPoints[i] = totalDuration * ((i + 1) / (cutPoints.length + 1));
    }
    return;
  }

  // Push forward any cut point that's too close to its predecessor
  for (let i = 0; i < cutPoints.length; i++) {
    const prev = i === 0 ? 0 : cutPoints[i - 1];
    if (cutPoints[i] - prev < MIN_GAP_SECONDS) {
      cutPoints[i] = prev + MIN_GAP_SECONDS;
    }
  }

  // Pull back from the end if last cut is too close to totalDuration
  for (let i = cutPoints.length - 1; i >= 0; i--) {
    const next = i === cutPoints.length - 1 ? totalDuration : cutPoints[i + 1];
    if (next - cutPoints[i] < MIN_GAP_SECONDS) {
      cutPoints[i] = next - MIN_GAP_SECONDS;
    }
  }

  // Final clamp
  for (let i = 0; i < cutPoints.length; i++) {
    cutPoints[i] = Math.max(cutPoints[i], 0.1);
  }
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function findCharIndexForTime(alignment: Alignment, time: number): number {
  for (let i = 0; i < alignment.character_start_times_seconds.length; i++) {
    if (alignment.character_start_times_seconds[i] >= time) return i;
  }
  return alignment.characters.length;
}

/**
 * Progressive search: try 5, 3, 2, 1 words from narration start.
 * Uses normalized text and searches from minCharIdx onward.
 */
function findCutTimeForText(
  normAlignText: string,
  alignment: Alignment,
  narration: string,
  minCharIdx: number
): number | null {
  const normNarration = normalize(narration);
  const words = normNarration.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  // Build normalized-char-index to original-char-index mapping
  const origText = alignment.characters.join('');
  const normFull = normalize(origText);
  const normToOrig = buildNormToOrigMap(origText, normFull);

  const searchFrom = normAlignText.length > 0 ? Math.min(minCharIdx, normAlignText.length - 1) : 0;

  for (const count of [5, 3, 2, 1]) {
    if (count > words.length) continue;
    const phrase = words.slice(0, count).join(' ');
    const idx = normFull.indexOf(phrase, searchFrom);
    if (idx >= 0) {
      const origIdx = normToOrig[idx];
      if (origIdx !== undefined && origIdx < alignment.character_start_times_seconds.length) {
        return alignment.character_start_times_seconds[origIdx];
      }
    }
  }

  return null;
}

/**
 * Build a mapping from normalized string index to original string index.
 */
function buildNormToOrigMap(original: string, _normalized: string): number[] {
  const map: number[] = [];
  const nfd = original.normalize('NFD');

  // Build nfd-index to original-index
  const nfdToOrig: number[] = [];
  let origIdx = 0;
  const origChars = [...original];
  const nfdChars = [...nfd];
  let oi = 0;
  for (let ni = 0; ni < nfdChars.length; ni++) {
    // Map NFD chars back to original chars
    nfdToOrig.push(oi);
    // Advance original index when we've consumed the NFD expansion of the current char
    if (oi < origChars.length) {
      const expanded = origChars[oi].normalize('NFD');
      const startNi = ni;
      if (ni - startNi + 1 >= expanded.length) {
        // This is a simplification; use character-by-character approach
      }
    }
  }

  // Simpler approach: step through both strings
  const normResult: string[] = [];
  const normToOrigResult: number[] = [];
  let oIdx = 0;
  const nfdStr = original.normalize('NFD');

  for (let i = 0; i < nfdStr.length; i++) {
    const ch = nfdStr[i];
    // Skip combining marks (accents)
    if (/[\u0300-\u036f]/.test(ch)) continue;

    const lower = ch.toLowerCase();
    // Keep only alphanumeric and spaces
    if (/[a-z0-9]/.test(lower)) {
      normResult.push(lower);
      normToOrigResult.push(oIdx);
    } else if (/\s/.test(ch)) {
      // Collapse spaces
      if (normResult.length > 0 && normResult[normResult.length - 1] !== ' ') {
        normResult.push(' ');
        normToOrigResult.push(oIdx);
      }
    }
    // Other punctuation: skip but advance

    // Track original index: each non-combining NFD char corresponds to one original position
    oIdx++;
  }

  // Trim trailing space
  if (normResult.length > 0 && normResult[normResult.length - 1] === ' ') {
    normResult.pop();
    normToOrigResult.pop();
  }

  return normToOrigResult;
}

/** @deprecated Use findSubSceneCutPoints instead */
export function findSegmentCutPoints(rawText: string, alignment: Alignment, segments: Segment[]): number[] {
  if (segments.length <= 1) return [];

  const totalDuration = alignment.character_end_times_seconds[alignment.character_end_times_seconds.length - 1] || 0;
  const normAlignText = normalize(alignment.characters.join(''));
  const cutPoints: number[] = [];
  let lastCharIdx = 0;

  for (let i = 0; i < segments.length - 1; i++) {
    const nextNarration = segments[i + 1].narration;
    const cutTime = findCutTimeForText(normAlignText, alignment, nextNarration, lastCharIdx);
    if (cutTime !== null) {
      cutPoints.push(cutTime);
      const charIdx = findCharIndexForTime(alignment, cutTime);
      if (charIdx > lastCharIdx) lastCharIdx = charIdx;
    } else {
      const wordsBefore = segments.slice(0, i + 1).reduce((sum, s) => sum + countWords(s.narration), 0);
      const totalWords = segments.reduce((sum, s) => sum + countWords(s.narration), 0);
      cutPoints.push(totalDuration * (wordsBefore / totalWords));
    }
  }

  for (let i = 1; i < cutPoints.length; i++) {
    if (cutPoints[i] <= cutPoints[i - 1]) {
      cutPoints[i] = cutPoints[i - 1] + 0.1;
    }
  }

  enforceMinGap(cutPoints, totalDuration);
  return cutPoints;
}
