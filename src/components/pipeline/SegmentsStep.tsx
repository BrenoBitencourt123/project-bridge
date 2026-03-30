import { useState } from 'react';
import { ArrowRight, Layers, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Project, Segment } from '@/types/atlas';
import { SegmentCard } from './SegmentCard';
import { useToast } from '@/hooks/use-toast';
import { splitIntoSubScenes } from '@/lib/split-sub-scenes';
import { CostEstimateCard } from './CostEstimateCard';
import { Progress } from '@/components/ui/progress';

interface SegmentsStepProps {
  project: Project;
  segments: Segment[];
  onSegmentsChange: (segments: Segment[]) => void;
  onUpdate: (updates: Partial<Project>) => void;
  onNext: () => void;
}

/** Call the AI edge function to split a scene into sub-scenes semantically.
 *  Falls back to the local mechanical splitter on error. */
async function splitWithAI(
  narration: string,
  sceneTitle?: string,
  totalWordCount?: number,
  totalScenes?: number,
  sceneFunction?: string,
): Promise<{ narration_segment: string; image_prompt: string | null }[]> {
  try {
    const { data, error } = await supabase.functions.invoke('split-sub-scenes', {
      body: {
        narration,
        scene_title: sceneTitle || null,
        scene_function: sceneFunction || null,
        total_word_count: totalWordCount || null,
        total_scenes: totalScenes || null,
      },
    });
    if (error) throw error;
    const subs = data?.sub_scenes;
    if (Array.isArray(subs) && subs.length > 0) {
      return subs.map((s: any) => ({
        narration_segment: s.narration_segment,
        image_prompt: s.image_prompt || null,
      }));
    }
    throw new Error('empty');
  } catch (err) {
    console.warn('split-sub-scenes AI failed, using local fallback:', err);
    const local = splitIntoSubScenes(narration, null);
    return local.map(s => ({
      narration_segment: s.narration_segment,
      image_prompt: s.image_prompt,
    }));
  }
}

export function SegmentsStep({ project, segments, onSegmentsChange, onUpdate, onNext }: SegmentsStepProps) {
  const [segmenting, setSegmenting] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const { toast } = useToast();

  /** Shared logic: given inserted segments, call AI to split each into sub-scenes */
  async function createSubScenesWithAI(inserted: any[], sceneLabels?: string[], totalWordCount?: number, sceneFunctions?: string[]) {
    const allSubScenes: any[] = [];
    for (let idx = 0; idx < inserted.length; idx++) {
      const seg = inserted[idx];
      setProgressMsg(`Dividindo cena ${idx + 1}/${inserted.length} em sub-cenas...`);
      setProgressPct(Math.round(((idx) / inserted.length) * 100));

      const subs = await splitWithAI(
        seg.narration,
        sceneLabels?.[idx],
        totalWordCount,
        inserted.length,
        sceneFunctions?.[idx],
      );
      for (let si = 0; si < subs.length; si++) {
        allSubScenes.push({
          segment_id: seg.id,
          sub_index: si + 1,
          narration_segment: subs[si].narration_segment,
          image_prompt: subs[si].image_prompt,
          image_status: 'idle',
        });
      }
    }
    setProgressPct(100);
    setProgressMsg('');

    let insertedSubScenes: any[] = [];
    if (allSubScenes.length > 0) {
      const { data: subData, error: subErr } = await supabase
        .from('sub_scenes')
        .insert(allSubScenes)
        .select();
      if (subErr) throw subErr;
      insertedSubScenes = subData || [];
    }
    return insertedSubScenes;
  }

  /** Delete existing segments & sub-scenes for this project */
  async function deleteExisting() {
    const existingSegmentIds = segments.map(s => s.id);
    if (existingSegmentIds.length > 0) {
      await supabase.from('sub_scenes').delete().in('segment_id', existingSegmentIds);
    }
    await supabase.from('segments').delete().eq('project_id', project.id);
  }

  /** Finalize: update project status, notify parent */
  async function finalize(inserted: any[], insertedSubScenes: any[]) {
    const segmentsWithSubs = (inserted as Segment[]).map(seg => ({
      ...seg,
      sub_scenes: insertedSubScenes
        .filter((sc: any) => sc.segment_id === seg.id)
        .sort((a: any, b: any) => a.sub_index - b.sub_index),
    }));

    await supabase.from('projects').update({ status: 'segmented', updated_at: new Date().toISOString() }).eq('id', project.id);
    onUpdate({ status: 'segmented' });
    onSegmentsChange(segmentsWithSubs);

    const totalSub = insertedSubScenes.length;
    toast({ title: `${inserted.length} blocos criados com ${totalSub} sub-cenas!` });
  }

  const handleSegment = async () => {
    if (!project.raw_script) return;
    setSegmenting(true);
    try {
      const sceneMarkerRegex = /^CENA\s+\d+/im;
      const hasSceneMarkers = sceneMarkerRegex.test(project.raw_script);

      let paragraphs: string[];
      let sceneLabels: string[] | undefined;

      if (hasSceneMarkers) {
        const splitRegex = /^(?=CENA\s+\d+)/im;
        const blocks = project.raw_script
          .split(splitRegex)
          .map(block => block.trim())
          .filter(block => block.length > 0);
        paragraphs = [];
        sceneLabels = [];
        for (const block of blocks) {
          const lines = block.split('\n');
          const label = lines[0].trim();
          const narration = lines.slice(1).join('\n').trim() || label;
          sceneLabels.push(label);
          paragraphs.push(narration);
        }
      } else {
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

      await deleteExisting();

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

      const scriptWordCount = project.raw_script?.trim().split(/\s+/).length || 0;
      const insertedSubScenes = await createSubScenesWithAI(inserted, sceneLabels, scriptWordCount);
      await finalize(inserted, insertedSubScenes);
    } catch (err: any) {
      toast({ title: 'Erro ao segmentar', description: err.message, variant: 'destructive' });
    } finally {
      setSegmenting(false);
      setProgressMsg('');
      setProgressPct(0);
    }
  };

  const handleAdapt = async () => {
    if (!project.raw_script) return;

    const hasSceneMarkers = /^CENA\s+\d+/im.test(project.raw_script);
    if (hasSceneMarkers) {
      return handleSegment();
    }

    setAdapting(true);
    try {
      setProgressMsg('Adaptando roteiro com IA...');
      const { data, error } = await supabase.functions.invoke('adapt-script', {
        body: { script: project.raw_script },
      });
      if (error) throw error;

      const videoScript: { time: string; narration: string; visual: string }[] = data.video_script || [];
      if (videoScript.length === 0) throw new Error('A IA não retornou blocos de cena');

      await deleteExisting();

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

      const adaptWordCount = newSegments.reduce((sum, s) => sum + s.narration.split(/\s+/).length, 0);
      const insertedSubScenes = await createSubScenesWithAI(inserted, undefined, adaptWordCount);
      await finalize(inserted, insertedSubScenes);
    } catch (err: any) {
      toast({ title: 'Erro ao adaptar roteiro', description: err.message, variant: 'destructive' });
    } finally {
      setAdapting(false);
      setProgressMsg('');
      setProgressPct(0);
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

  const isProcessing = segmenting || adapting;
  const totalSubScenes = segments.reduce((sum, s) => sum + (s.sub_scenes?.length || 0), 0);
  const totalChars = segments.flatMap(s => s.sub_scenes || []).reduce((sum, sc) => sum + (sc.narration_segment?.length || 0), 0);
  const totalWords = project.raw_script?.trim().split(/\s+/).length || 0;
  const estimatedDurationSec = (totalWords / 167) * 60;
  const avgSecondsPerSub = totalSubScenes > 0 ? (estimatedDurationSec / totalSubScenes).toFixed(1) : '0';

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button onClick={handleAdapt} disabled={isProcessing}>
          {adapting ? <Loader2 className="animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {segments.length > 0 ? 'Re-adaptar com IA' : 'Adaptar com IA'}
        </Button>
        <Button variant="outline" onClick={handleSegment} disabled={isProcessing}>
          {segmenting ? <Loader2 className="animate-spin" /> : <Layers className="h-4 w-4" />}
          {segments.length > 0 ? 'Re-segmentar (rápido)' : 'Segmentar por parágrafos'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        <strong>Adaptar com IA</strong> gera descrições visuais para cada bloco · <strong>Segmentar por parágrafos</strong> divide por marcadores de CENA ou parágrafos
      </p>

      {isProcessing && progressMsg && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{progressMsg}</p>
          <Progress value={progressPct} className="h-2" />
        </div>
      )}

      {segments.length > 0 && !isProcessing && (
        <>
          <p className="text-sm text-muted-foreground">
            {segments.length} blocos · {totalSubScenes} sub-cenas · ~{avgSecondsPerSub}s/sub-cena · ~{Math.round(estimatedDurationSec / 60)}min estimados
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
