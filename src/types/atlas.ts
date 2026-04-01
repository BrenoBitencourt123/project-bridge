export interface VoiceSettings {
  voice_id: string;
  model: string;
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  speaker_boost: boolean;
  language_code: string;
  output_format: string;
}

export type ProjectStatus = 'draft' | 'scripted' | 'segmented' | 'images_done' | 'audio_done' | 'complete';
export type MomentType = 'hook' | 'concept' | 'example' | 'list_summary' | 'cta';
export type MediaStatus = 'idle' | 'generating' | 'done' | 'error';

export interface Project {
  id: string;
  user_id: string;
  title: string;
  subject: string | null;
  topic: string | null;
  difficulty_level: string | null;
  target_duration: number | null;
  raw_script: string | null;
  status: ProjectStatus;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubScene {
  id: string;
  segment_id: string;
  sub_index: number;
  narration_segment: string;
  image_prompt: string | null;
  image_url: string | null;
  image_status: MediaStatus;
  audio_url: string | null;
  audio_status: MediaStatus;
}

export interface Segment {
  id: string;
  project_id: string;
  sequence_number: number;
  narration: string;
  image_prompt: string | null;
  symbolism: string | null;
  moment_type: MomentType | null;
  duration_estimate: number | null;
  image_url: string | null;
  audio_url: string | null;
  image_status: MediaStatus;
  audio_status: MediaStatus;
  sub_scenes?: SubScene[];
}

export interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  voice_settings: VoiceSettings | null;
  created_at: string;
  updated_at: string;
}

export interface Voice {
  voice_id: string;
  name: string;
  category: string;
  gender: string;
  age: string;
  accent: string;
  use_case: string;
  description: string;
  supports_pt: boolean;
  is_recommended: boolean;
  preview_url: string;
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string }> = {
  draft: { label: 'Rascunho', color: 'bg-muted text-muted-foreground' },
  scripted: { label: 'Roteiro', color: 'bg-primary/20 text-primary' },
  segmented: { label: 'Segmentado', color: 'bg-warning/20 text-warning' },
  images_done: { label: 'Imagens', color: 'bg-success/20 text-success' },
  audio_done: { label: 'Áudio', color: 'bg-success/20 text-success' },
  complete: { label: 'Completo', color: 'bg-success/20 text-success' },
};

export const MOMENT_TYPE_CONFIG: Record<MomentType, { label: string; color: string }> = {
  hook: { label: 'Hook', color: 'bg-warning/20 text-warning' },
  concept: { label: 'Conceito', color: 'bg-primary/20 text-primary' },
  example: { label: 'Exemplo', color: 'bg-success/20 text-success' },
  list_summary: { label: 'Resumo', color: 'bg-muted text-muted-foreground' },
  cta: { label: 'CTA', color: 'bg-destructive/20 text-destructive' },
};

export function getMaxStep(status: ProjectStatus): number {
  switch (status) {
    case 'draft': return 0;
    case 'scripted':
    case 'segmented':
    case 'images_done':
    case 'audio_done': return 1;
    case 'complete': return 2;
  }
}
