import { useState } from 'react';
import { ArrowRight, Layers, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Project, Segment } from '@/types/atlas';
import { SegmentCard } from './SegmentCard';
import { useToast } from '@/hooks/use-toast';
import { splitIntoSubScenes } from '@/lib/split-sub-scenes';
import { CostEstimateCard } from './CostEstimateCard';

interface SegmentsStepProps {
  project: Project;
  segments: Segment[];
  onSegmentsChange: (segments: Segment[]) => void;
  onUpdate: (updates: Partial<Project>) => void;
  onNext: () => void;
}

export function SegmentsStep({ project, segments, onSegmentsChange, onUpdate, onNext }: SegmentsStepProps) {
  const [segmenting, setSegmenting] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleSegment = async () => {
    if (!project.raw_script) return;
    setSegmenting(true);
    try {
      // Detectar se o roteiro já tem marcadores de CENA
      const sceneMarkerRegex = /^CENA\s+\d+/im;
      const hasSceneMarkers = sceneMarkerRegex.test(project.raw_script);

      let paragraphs: string[];

      if (hasSceneMarkers) {
        // Dividir pelos marcadores de CENA, preservando a estrutura do usuário
        const splitRegex = /^(?=CENA\s+\d+)/im;
        paragraphs = project.raw_script
          .split(splitRegex)
          .map(block => block.trim())
          .filter(block => block.length > 0);
      } else {
        // Fallback: agrupa parágrafos até ~90 palavras por bloco
        const rawParagraphs = project.raw_script
          .split(/\n\n+/)
          .map(p => p.trim())
          .filter(p => p.length > 0);

        const TARGET_WORDS = 90;
        paragraphs = [];
        let buffer = '';
        let bufferWords = 0;
        for (const p of rawParagraphs) {
          const pWords = p.split(/\s+/).length;
          if (buffer && bufferWords + pWords > TARGET_WORDS * 1.2) {
            paragraphs.push(buffer);
            buffer = p;
            bufferWords = pWords;
          } else {
            buffer = buffer ? `${buffer}\n\n${p}` : p;
            bufferWords += pWords;
          }
        }
        if (buffer) paragraphs.push(buffer);
      }

      // Deletar sub-cenas e segmentos existentes
      const existingSegmentIds = segments.map(s => s.id);
      if (existingSegmentIds.length > 0) {
        await supabase.from('sub_scenes').delete().in('segment_id', existingSegmentIds);
      }
      await supabase.from('segments').delete().eq('project_id', project.id);

      // Inserir segmentos derivados dos parágrafos
      const newSegments = paragraphs.map((p, i) => ({
        project_id: project.id,
        sequence_number: i + 1,
        narration: p,
        image_prompt: null,
        symbolism: null,
        moment_type: null,
        duration_estimate: p.split(/\s+/).length / 3.67,
        image_status: 'idle' as const,
        audio_status: 'idle' as const,
      }));

      const { data: inserted, error: insertErr } = await supabase
        .from('segments')
        .insert(newSegments)
        .select();
      if (insertErr) throw insertErr;

      // Criar sub-cenas para cada segmento
      const allSubScenes: any[] = [];
      for (const seg of inserted) {
        const subSceneInputs = splitIntoSubScenes(seg.narration, seg.image_prompt, seg.moment_type);
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

  const handleAdapt = async () => {
    if (!project.raw_script) return;
    setAdapting(true);
    try {
      const { data, error } = await supabase.functions.invoke('adapt-script', {
        body: { script: project.raw_script },
      });
      if (error) throw error;

      const videoScript: { time: string; narration: string; visual: string }[] = data.video_script || [];
      if (videoScript.length === 0) throw new Error('A IA não retornou blocos de cena');

      // Deletar sub-cenas e segmentos existentes
      const existingSegmentIds = segments.map(s => s.id);
      if (existingSegmentIds.length > 0) {
        await supabase.from('sub_scenes').delete().in('segment_id', existingSegmentIds);
      }
      await supabase.from('segments').delete().eq('project_id', project.id);

      // Inserir segmentos derivados da adaptação com IA
      const newSegments = videoScript
        .filter(b => b.narration && b.narration.trim().length > 0)
        .map((b, i) => ({
          project_id: project.id,
          sequence_number: i + 1,
          narration: b.narration.trim(),
          image_prompt: b.visual?.trim() || null,
          symbolism: null,
          moment_type: null,
          duration_estimate: b.narration.trim().split(/\s+/).length / 3.67,
          image_status: 'idle' as const,
          audio_status: 'idle' as const,
        }));

      const { data: inserted, error: insertErr } = await supabase
        .from('segments')
        .insert(newSegments)
        .select();
      if (insertErr) throw insertErr;

      // Criar sub-cenas para cada segmento
      const allSubScenes: any[] = [];
      for (const seg of inserted) {
        const subSceneInputs = splitIntoSubScenes(seg.narration, seg.image_prompt, seg.moment_type);
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

      const segmentsWithSubs = (inserted as Segment[]).map(seg => ({
        ...seg,
        sub_scenes: insertedSubScenes
          .filter((sc: any) => sc.segment_id === seg.id)
          .sort((a: any, b: any) => a.sub_index - b.sub_index),
      }));

      await supabase.from('projects').update({ status: 'segmented', updated_at: new Date().toISOString() }).eq('id', project.id);
      onUpdate({ status: 'segmented' });
      onSegmentsChange(segmentsWithSubs);

      toast({ title: `${inserted.length} blocos criados com ${insertedSubScenes.length} sub-cenas!` });
    } catch (err: any) {
      toast({ title: 'Erro ao adaptar roteiro', description: err.message, variant: 'destructive' });
    } finally {
      setAdapting(false);
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
  const totalChars = segments.flatMap(s => s.sub_scenes || []).reduce((sum, sc) => sum + (sc.narration_segment?.length || 0), 0);
  const totalWords = project.raw_script?.trim().split(/\s+/).length || 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button onClick={handleAdapt} disabled={adapting || segmenting}>
          {adapting ? <Loader2 className="animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {segments.length > 0 ? 'Re-adaptar com IA' : 'Adaptar com IA'}
        </Button>
        <Button variant="outline" onClick={handleSegment} disabled={segmenting || adapting}>
          {segmenting ? <Loader2 className="animate-spin" /> : <Layers className="h-4 w-4" />}
          {segments.length > 0 ? 'Re-segmentar (rápido)' : 'Segmentar por parágrafos'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        <strong>Adaptar com IA</strong> gera descrições visuais para cada bloco · <strong>Segmentar por parágrafos</strong> é instantâneo, sem IA
      </p>

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
          <CostEstimateCard
            wordCount={totalWords}
            charCount={totalChars}
            subSceneCount={totalSubScenes}
          />
          <Button className="w-full" onClick={handleSaveAndNext} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Salvar & Gerar Mídia <ArrowRight className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
