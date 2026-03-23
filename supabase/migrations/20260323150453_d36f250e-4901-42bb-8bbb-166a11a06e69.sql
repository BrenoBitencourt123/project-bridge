
-- Enums
CREATE TYPE public.project_status AS ENUM ('draft', 'scripted', 'segmented', 'images_done', 'audio_done', 'complete');
CREATE TYPE public.moment_type AS ENUM ('hook', 'concept', 'example', 'list_summary', 'cta');
CREATE TYPE public.media_status AS ENUM ('idle', 'generating', 'done', 'error');

-- Timestamp trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  voice_settings JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT,
  topic TEXT,
  difficulty_level TEXT,
  target_duration INTEGER DEFAULT 10,
  raw_script TEXT,
  status public.project_status NOT NULL DEFAULT 'draft',
  thumbnail_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects" ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own projects" ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own projects" ON public.projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own projects" ON public.projects FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Segments table
CREATE TABLE public.segments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  narration TEXT NOT NULL,
  image_prompt TEXT,
  symbolism TEXT,
  moment_type public.moment_type,
  duration_estimate NUMERIC(5,2),
  image_url TEXT,
  audio_url TEXT,
  image_status public.media_status NOT NULL DEFAULT 'idle',
  audio_status public.media_status NOT NULL DEFAULT 'idle',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, sequence_number)
);

ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own segments" ON public.segments FOR SELECT USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = segments.project_id AND projects.user_id = auth.uid()));
CREATE POLICY "Users can insert own segments" ON public.segments FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = segments.project_id AND projects.user_id = auth.uid()));
CREATE POLICY "Users can update own segments" ON public.segments FOR UPDATE USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = segments.project_id AND projects.user_id = auth.uid()));
CREATE POLICY "Users can delete own segments" ON public.segments FOR DELETE USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = segments.project_id AND projects.user_id = auth.uid()));

CREATE TRIGGER update_segments_updated_at BEFORE UPDATE ON public.segments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('segment-images', 'segment-images', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('segment-audio', 'segment-audio', true);

CREATE POLICY "Public read segment images" ON storage.objects FOR SELECT USING (bucket_id = 'segment-images');
CREATE POLICY "Auth users upload segment images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'segment-images' AND auth.role() = 'authenticated');
CREATE POLICY "Auth users update segment images" ON storage.objects FOR UPDATE USING (bucket_id = 'segment-images' AND auth.role() = 'authenticated');

CREATE POLICY "Public read segment audio" ON storage.objects FOR SELECT USING (bucket_id = 'segment-audio');
CREATE POLICY "Auth users upload segment audio" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'segment-audio' AND auth.role() = 'authenticated');
CREATE POLICY "Auth users update segment audio" ON storage.objects FOR UPDATE USING (bucket_id = 'segment-audio' AND auth.role() = 'authenticated');
