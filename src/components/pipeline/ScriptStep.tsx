import { useState } from 'react';
import { ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { Project } from '@/types/atlas';
import { useToast } from '@/hooks/use-toast';

interface ScriptStepProps {
  project: Project;
  onUpdate: (updates: Partial<Project>) => void;
  onNext: () => void;
}

export function ScriptStep({ project, onUpdate, onNext }: ScriptStepProps) {
  const [script, setScript] = useState(project.raw_script || '');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estimatedMinutes = (wordCount / 220).toFixed(1);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-script', {
        body: { freePrompt: `Gere um roteiro educacional sobre: ${project.title}`, subject: project.subject, topic: project.topic, targetDuration: project.target_duration },
      });
      if (error) throw error;
      setScript(data.script);
    } catch (err: any) {
      toast({ title: 'Erro ao gerar roteiro', description: err.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveAndNext = async () => {
    if (!script.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('projects')
        .update({ raw_script: script, status: 'scripted', updated_at: new Date().toISOString() })
        .eq('id', project.id);
      if (error) throw error;
      onUpdate({ raw_script: script, status: 'scripted' });
      onNext();
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {wordCount} palavras · ~{estimatedMinutes} min
        </div>
        <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
          {generating ? <Loader2 className="animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Gerar com IA
        </Button>
      </div>
      <Textarea
        value={script}
        onChange={e => setScript(e.target.value)}
        placeholder="Escreva ou cole seu roteiro aqui..."
        rows={20}
        className="font-mono text-sm"
      />
      <Button className="w-full" onClick={handleSaveAndNext} disabled={!script.trim() || saving}>
        {saving && <Loader2 className="animate-spin" />}
        Salvar & Segmentar <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
