ALTER TABLE public.sub_scenes
  ADD COLUMN audio_url TEXT,
  ADD COLUMN audio_status public.media_status NOT NULL DEFAULT 'idle'::media_status;