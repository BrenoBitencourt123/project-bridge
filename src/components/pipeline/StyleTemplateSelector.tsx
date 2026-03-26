import { useEffect } from 'react';
import { Palette } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface StyleTemplate {
  id: string;
  name: string;
  description: string | null;
  prompt_prefix: string;
  is_default: boolean;
}

interface StyleTemplateSelectorProps {
  value: string | null;
  onChange: (templateId: string, promptPrefix: string, name?: string) => void;
}

export function StyleTemplateSelector({ value, onChange }: StyleTemplateSelectorProps) {
  const { data: templates = [] } = useQuery({
    queryKey: ['style-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('image_style_templates')
        .select('*')
        .order('is_default', { ascending: false });
      if (error) throw error;
      return data as StyleTemplate[];
    },
  });

  // Auto-select first default template
  useEffect(() => {
    if (!value && templates.length > 0) {
      const defaultTemplate = templates.find(t => t.is_default) || templates[0];
      onChange(defaultTemplate.id, defaultTemplate.prompt_prefix, defaultTemplate.name);
    }
  }, [templates, value]);

  const handleChange = (id: string) => {
    const template = templates.find(t => t.id === id);
    if (template) onChange(template.id, template.prompt_prefix, template.name);
  };

  return (
    <div className="flex items-center gap-2">
      <Palette className="h-4 w-4 text-muted-foreground" />
      <Select value={value || ''} onValueChange={handleChange}>
        <SelectTrigger className="w-[200px] h-8 text-xs">
          <SelectValue placeholder="Estilo visual..." />
        </SelectTrigger>
        <SelectContent>
          {templates.map(t => (
            <SelectItem key={t.id} value={t.id}>
              <div>
                <span className="text-sm">{t.name}</span>
                {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
