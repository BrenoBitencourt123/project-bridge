
CREATE TABLE public.sub_scenes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  segment_id UUID NOT NULL REFERENCES public.segments(id) ON DELETE CASCADE,
  sub_index INTEGER NOT NULL,
  narration_segment TEXT NOT NULL,
  image_prompt TEXT,
  image_url TEXT,
  image_status public.media_status NOT NULL DEFAULT 'idle'::media_status,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(segment_id, sub_index)
);

ALTER TABLE public.sub_scenes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sub_scenes" ON public.sub_scenes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.segments s
    JOIN public.projects p ON p.id = s.project_id
    WHERE s.id = sub_scenes.segment_id AND p.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own sub_scenes" ON public.sub_scenes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.segments s
    JOIN public.projects p ON p.id = s.project_id
    WHERE s.id = sub_scenes.segment_id AND p.user_id = auth.uid()
  ));

CREATE POLICY "Users can update own sub_scenes" ON public.sub_scenes
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.segments s
    JOIN public.projects p ON p.id = s.project_id
    WHERE s.id = sub_scenes.segment_id AND p.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete own sub_scenes" ON public.sub_scenes
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.segments s
    JOIN public.projects p ON p.id = s.project_id
    WHERE s.id = sub_scenes.segment_id AND p.user_id = auth.uid()
  ));

CREATE TRIGGER update_sub_scenes_updated_at
  BEFORE UPDATE ON public.sub_scenes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
