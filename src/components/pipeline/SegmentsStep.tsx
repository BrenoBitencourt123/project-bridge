import { useState } from 'react';
import { ArrowRight, Layers, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Project, Segment } from '@/types/atlas';
import { SegmentCard } from './SegmentCard';
import { useToast } from '@/hooks/use-toast';
import { splitIntoSubScenes } from '@/lib/split-sub-scenes';

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

      // Delete existing sub_scenes first (cascade would handle it, but let's be safe with existing segments)
      const existingSegmentIds = segments.map(s => s.id);
      if (existingSegmentIds.length > 0) {
        await supabase.from('sub_scenes').delete().in('segment_id', existingSegmentIds);
      }
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
          image_status: 'idle' as const,
          audio_status: 'idle' as const,
        };
      });

      const validSegments = newSegments.filter((s: any) => s.narration && s.narration.trim() !== '');

      const { data: inserted, error: insertErr } = await supabase
        .from('segments')
        .insert(validSegments)
        .select();
      if (insertErr) throw insertErr;

      // Create sub-scenes for each inserted segment
      const allSubScenes: any[] = [];
      for (const seg of inserted) {
        const subSceneInputs = splitIntoSubScenes(seg.narration, seg.image_prompt);
        for (const sc of subSceneInputs) {
          allSubScenes.push({
            segment_id: seg.id,
            sub_index: sc.sub_index,
            narration_segment: sc.narration_segment,
            image_prompt: sc.image_prompt,
            image_status: 'idle',
          });
        }
      }

      let insertedSubScenes: any[] = [];
      if (allSubScenes.length > 0) {
        const { data: subData, error: subErr } = await supabase
          .from('sub_scenes')
          .insert(allSubScenes)
          .select();
        if (subErr) throw subErr;
        insertedSubScenes = subData || [];
      }

      // Attach sub_scenes to segments
      const segmentsWithSubs = (inserted as Segment[]).map(seg => ({
        ...seg,
        sub_scenes: insertedSubScenes
          .filter((sc: any) => sc.segment_id === seg.id)
          .sort((a: any, b: any) => a.sub_index - b.sub_index),
      }));

      await supabase.from('projects').update({ status: 'segmented', updated_at: new Date().toISOString() }).eq('id', project.id);
      onUpdate({ status: 'segmented' });
      onSegmentsChange(segmentsWithSubs);

      const totalSubScenes = insertedSubScenes.length;
      toast({ title: `${inserted.length} blocos criados com ${totalSubScenes} sub-cenas!` });
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

        // Save sub-scene edits too
        if (seg.sub_scenes) {
          for (const sc of seg.sub_scenes) {
            await supabase.from('sub_scenes').update({
              narration_segment: sc.narration_segment,
              image_prompt: sc.image_prompt,
            }).eq('id', sc.id);
          }
        }
      }
      onNext();
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const totalSubScenes = segments.reduce((sum, s) => sum + (s.sub_scenes?.length || 0), 0);

  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={handleSegment} disabled={segmenting}>
        {segmenting ? <Loader2 className="animate-spin" /> : <Layers className="h-4 w-4" />}
        {segments.length > 0 ? 'Re-segmentar' : 'Segmentar Roteiro'}
      </Button>

      {segments.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            {segments.length} blocos · {totalSubScenes} sub-cenas
          </p>
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
