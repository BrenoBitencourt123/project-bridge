
-- Enable realtime on sub_scenes
ALTER PUBLICATION supabase_realtime ADD TABLE public.sub_scenes;

-- Image style templates table
CREATE TABLE public.image_style_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  prompt_prefix text NOT NULL,
  is_default boolean DEFAULT false,
  user_id uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.image_style_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view default templates"
ON public.image_style_templates FOR SELECT TO authenticated
USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users can insert own templates"
ON public.image_style_templates FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own templates"
ON public.image_style_templates FOR UPDATE TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can delete own templates"
ON public.image_style_templates FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- Seed default templates
INSERT INTO public.image_style_templates (name, description, prompt_prefix, is_default) VALUES
('Lousa Educacional', 'Fundo escuro com fórmulas, sketch a giz, estilo quadro negro', 'STYLE: Hand-drawn sketch on beige/cream paper background. Pencil cross-hatching with slight roughness. Grayscale tones with ONLY blue (#4A90E2) as accent color for highlights and emphasis. Educational illustration style.', true),
('Flat Design Colorido', 'Ilustração vetorial com cores vibrantes e fundo limpo', 'STYLE: Flat design vector illustration. Bold vibrant colors, clean geometric shapes, no gradients, solid fills. Modern infographic style with clean white or light background. Minimal shadows.', true),
('Realista Cinematográfico', 'Fotorrealista com iluminação dramática e profundidade', 'STYLE: Photorealistic, cinematic lighting with dramatic shadows and highlights. Shallow depth of field. Rich color grading with warm tones. Professional photography quality.', true),
('Cartoon / Mangá', 'Estilo anime/cartoon com personagens expressivos', 'STYLE: Anime/manga cartoon style. Bold black outlines, expressive characters with large eyes, dynamic poses. Vibrant cel-shading colors. Clean backgrounds with speed lines or pattern fills.', true);

-- Assets table
CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  category text DEFAULT 'general',
  image_url text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own assets"
ON public.assets FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can insert own assets"
ON public.assets FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own assets"
ON public.assets FOR UPDATE TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can delete own assets"
ON public.assets FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- User assets storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('user-assets', 'user-assets', true);

CREATE POLICY "Users can upload own assets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'user-assets' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Anyone can view user assets"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'user-assets');

CREATE POLICY "Users can delete own assets"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'user-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
