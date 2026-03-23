import { useState } from 'react';
import { ArrowRight, Layers, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Project, Segment } from '@/types/atlas';
import { SegmentCard } from './SegmentCard';
import { useToast } from '@/hooks/use-toast';

interface SegmentsStepProps {
  project: Project;
  segments: Segment[];
  onSegmentsChange: (segments: Segment[]) => void;
  onUpdate: (updates: Partial<Project>) => void;
  onNext: () => void;
}

export function SegmentsStep({ project, segments, onSegmentsChange, onUpdate, onNext }: SegmentsStepProps) {
  const [segmenting, setSegmenting] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleSegment = async () => {
    if (!project.raw_script) return;
    setSegmenting(true);
    try {
      const { data, error } = await supabase.functions.invoke('segment-script', {
        body: { script: project.raw_script },
      });
      if (error) throw error;

      const validMomentTypes = new Set(['hook', 'concept', 'example', 'list_summary', 'cta']);

      // Delete existing segments
      await supabase.from('segments').delete().eq('project_id', project.id);

      // Insert new segments
      const newSegments = data.segments.map((s: any, i: number) => {
        const rawMomentType = s.momentType || s.moment_type || null;

        return {
          project_id: project.id,
          sequence_number: i + 1,
          narration: s.narration,
          image_prompt: s.imagePrompt || s.image_prompt || null,
          symbolism: s.symbolism || null,
          moment_type: validMomentTypes.has(rawMomentType) ? rawMomentType : null,
          duration_estimate: s.narration ? s.narration.split(/\s+/).length / 3.67 : null,
          image_status: 'idle',
          audio_status: 'idle',
        };
      });

      const validSegments = newSegments.filter((s: any) => s.narration && s.narration.trim() !== '');

      const { data: inserted, error: insertErr } = await supabase
        .from('segments')
        .insert(validSegments)
        .select();
      if (insertErr) throw insertErr;

      await supabase.from('projects').update({ status: 'segmented', updated_at: new Date().toISOString() }).eq('id', project.id);
      onUpdate({ status: 'segmented' });
      onSegmentsChange(inserted as Segment[]);
      toast({ title: `${inserted.length} segmentos criados!` });
    } catch (err: any) {
      toast({ title: 'Erro ao segmentar', description: err.message, variant: 'destructive' });
    } finally {
      setSegmenting(false);
    }
  };

  const updateSegmentLocal = (index: number, updates: Partial<Segment>) => {
    const updated = [...segments];
    updated[index] = { ...updated[index], ...updates };
    onSegmentsChange(updated);
  };

  const handleSaveAndNext = async () => {
    setSaving(true);
    try {
      for (const seg of segments) {
        await supabase.from('segments').update({
          narration: seg.narration,
          image_prompt: seg.image_prompt,
          symbolism: seg.symbolism,
        }).eq('id', seg.id);
      }
      onNext();
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={handleSegment} disabled={segmenting}>
        {segmenting ? <Loader2 className="animate-spin" /> : <Layers className="h-4 w-4" />}
        {segments.length > 0 ? 'Re-segmentar' : 'Segmentar Roteiro'}
      </Button>

      {segments.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">{segments.length} segmentos</p>
          <div className="space-y-2">
            {segments.map((seg, i) => (
              <SegmentCard key={seg.id} segment={seg} onUpdate={updates => updateSegmentLocal(i, updates)} />
            ))}
          </div>
          <Button className="w-full" onClick={handleSaveAndNext} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Salvar & Gerar Mídia <ArrowRight className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
