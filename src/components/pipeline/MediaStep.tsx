import { useState, useRef } from 'react';
import { Image, Volume2, RefreshCw, Upload, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Project, Segment, SubScene } from '@/types/atlas';
import { SegmentCard } from './SegmentCard';
import { useToast } from '@/hooks/use-toast';
import { splitAudioAtCutPoints, splitChunkedAudioAtCutPoints } from '@/lib/audio-splitter';
import { findSubSceneCutPoints } from '@/lib/find-cut-points';
import { AudioImportDialog } from './AudioImportDialog';
import type { Alignment } from '@/types/atlas';

interface MediaStepProps {
  project: Project;
  segments: Segment[];
  onSegmentsChange: (segments: Segment[]) => void;
  onUpdate: (updates: Partial<Project>) => void;
  onNext: () => void;
  onGeneratingChange?: (generating: boolean) => void;
}

export function MediaStep({ project, segments, onSegmentsChange, onUpdate, onNext, onGeneratingChange }: MediaStepProps) {
  const { toast } = useToast();
  const [generatingImages, setGeneratingImages] = useState(false);
  const [generatingAudios, setGeneratingAudios] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [imageProgress, setImageProgress] = useState(0);
  const [audioProgress, setAudioProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [genSubSceneId, setGenSubSceneId] = useState<string | null>(null);

  const allSubScenes = segments.flatMap(s => s.sub_scenes || []);
  const subScenesDone = allSubScenes.filter(sc => sc.image_status === 'done').length;
  const subAudiosDone = allSubScenes.filter(sc => sc.audio_status === 'done').length;
  const totalSubScenes = allSubScenes.length;

  const allDone = subScenesDone === totalSubScenes && subAudiosDone === totalSubScenes && totalSubScenes > 0;

  const updateSegment = (index: number, updates: Partial<Segment>) => {
    const updated = [...segments];
    updated[index] = { ...updated[index], ...updates };
    onSegmentsChange(updated);
  };

  const updateSubSceneInSegments = (segmentId: string, subSceneId: string, updates: Partial<SubScene>) => {
    const updated = segments.map(seg => {
      if (seg.id !== segmentId) return seg;
      return {
        ...seg,
        sub_scenes: (seg.sub_scenes || []).map(sc =>
          sc.id === subSceneId ? { ...sc, ...updates } : sc
        ),
      };
    });
    onSegmentsChange(updated);
  };

  const handleRegeneratePrompts = async () => {
    setRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('regenerate-prompts', {
        body: { segments: segments.map(s => ({ narration: s.narration, momentType: s.moment_type })) },
      });
      if (error) throw error;
      const updated = segments.map((s, i) => ({
        ...s,
        image_prompt: data.prompts[i]?.imagePrompt || s.image_prompt,
        symbolism: data.prompts[i]?.symbolism || s.symbolism,
      }));
      onSegmentsChange(updated);
      for (const seg of updated) {
        await supabase.from('segments').update({ image_prompt: seg.image_prompt, symbolism: seg.symbolism }).eq('id', seg.id);
      }
      toast({ title: 'Prompts regenerados!' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setRegenerating(false);
    }
  };

  const handleGenerateAllImages = async () => {
    setGeneratingImages(true);
    setImageProgress(0);
    let done = 0;

    for (const seg of segments) {
      const subScenes = seg.sub_scenes || [];
      for (const sc of subScenes) {
        if (sc.image_status === 'done') {
          done++;
          setImageProgress((done / totalSubScenes) * 100);
          continue;
        }
        updateSubSceneInSegments(seg.id, sc.id, { image_status: 'generating' });
        try {
          const { data, error } = await supabase.functions.invoke('generate-image', {
            body: {
              imagePrompt: sc.image_prompt,
              projectId: project.id,
              segmentId: seg.id,
              sequenceNumber: seg.sequence_number,
              subIndex: sc.sub_index,
              momentType: seg.moment_type,
            },
          });
          if (error) throw error;
          updateSubSceneInSegments(seg.id, sc.id, { image_url: data.imageUrl, image_status: 'done' });
          await supabase.from('sub_scenes').update({ image_url: data.imageUrl, image_status: 'done' }).eq('id', sc.id);
        } catch {
          updateSubSceneInSegments(seg.id, sc.id, { image_status: 'error' });
          await supabase.from('sub_scenes').update({ image_status: 'error' }).eq('id', sc.id);
        }
        done++;
        setImageProgress((done / totalSubScenes) * 100);
      }
    }

    await supabase.from('projects').update({ status: 'images_done', updated_at: new Date().toISOString() }).eq('id', project.id);
    onUpdate({ status: 'images_done' });
    setGeneratingImages(false);
  };

  const flattenSubScenes = (): { subScene: SubScene; segment: Segment; flatIndex: number }[] => {
    const flat: { subScene: SubScene; segment: Segment; flatIndex: number }[] = [];
    let idx = 0;
    for (const seg of segments) {
      for (const sc of (seg.sub_scenes || []).sort((a, b) => a.sub_index - b.sub_index)) {
        flat.push({ subScene: sc, segment: seg, flatIndex: idx++ });
      }
    }
    return flat;
  };

  const uploadSubSceneAudios = async (blobs: Blob[], flatSubs: { subScene: SubScene; segment: Segment }[]) => {
    for (let i = 0; i < blobs.length && i < flatSubs.length; i++) {
      const { subScene: sc, segment: seg } = flatSubs[i];
      const num = String(seg.sequence_number).padStart(3, '0');
      const fileName = `${project.id}/segment-${num}-sub-${sc.sub_index}.wav`;
      const { error: uploadErr } = await supabase.storage.from('segment-audio').upload(fileName, blobs[i], { upsert: true, contentType: 'audio/wav' });
      if (uploadErr) { console.error(uploadErr); continue; }
      const { data: urlData } = supabase.storage.from('segment-audio').getPublicUrl(fileName);
      updateSubSceneInSegments(seg.id, sc.id, { audio_url: urlData.publicUrl, audio_status: 'done' });
      await supabase.from('sub_scenes').update({ audio_url: urlData.publicUrl, audio_status: 'done' }).eq('id', sc.id);
      setAudioProgress(((i + 1) / flatSubs.length) * 100);
    }
  };

  const handleGenerateAllAudios = async () => {
    setGeneratingAudios(true);
    setAudioProgress(0);
    setStatusText('Gerando áudio completo...');
    try {
      const { data, error } = await supabase.functions.invoke('generate-audio-batch', {
        body: { rawScript: project.raw_script, projectId: project.id },
      });
      if (error) throw error;

      setStatusText('Processando alinhamento...');
      const alignment: Alignment = data.isChunked
        ? mergeAlignments(data.chunks.map((c: any) => c.alignment))
        : data.alignment;

      const cutTimes = findSubSceneCutPoints(project.raw_script!, alignment, segments);

      setStatusText('Fatiando áudio por sub-cena...');
      let blobs: Blob[];
      if (data.isChunked) {
        blobs = await splitChunkedAudioAtCutPoints(data.chunks.map((c: any) => c.audioBase64), cutTimes);
      } else {
        const audioBytes = Uint8Array.from(atob(data.fullAudioBase64), c => c.charCodeAt(0));
        blobs = await splitAudioAtCutPoints(audioBytes.buffer, cutTimes);
      }

      setStatusText('Enviando áudios das sub-cenas...');
      const flatSubs = flattenSubScenes();
      await uploadSubSceneAudios(blobs, flatSubs);

      await supabase.from('projects').update({ status: 'audio_done', updated_at: new Date().toISOString() }).eq('id', project.id);
      onUpdate({ status: 'audio_done' });
      toast({ title: 'Áudios gerados!' });
    } catch (err: any) {
      toast({ title: 'Erro ao gerar áudios', description: err.message, variant: 'destructive' });
    } finally {
      setGeneratingAudios(false);
      setStatusText('');
    }
  };

  const handleUploadAudio = async (orderedFiles: File[]) => {
    if (orderedFiles.length === 0) return;
    setUploadingAudio(true);
    setStatusText('Transcrevendo áudio...');
    try {
      const alignments: Alignment[] = [];
      const audioBuffers: ArrayBuffer[] = [];

      for (let i = 0; i < orderedFiles.length; i++) {
        setStatusText(`Transcrevendo parte ${i + 1} de ${orderedFiles.length}...`);
        const formData = new FormData();
        formData.append('audio', orderedFiles[i]);
        const { data, error } = await supabase.functions.invoke('transcribe-audio', { body: formData });
        if (error) throw error;
        alignments.push(data.alignment);
        audioBuffers.push(await orderedFiles[i].arrayBuffer());
      }

      setStatusText('Processando alinhamento...');
      const mergedAlignment = mergeAlignments(alignments);
      const cutTimes = findSubSceneCutPoints(project.raw_script!, mergedAlignment, segments);

      setStatusText('Fatiando áudio por sub-cena...');
      const totalLength = audioBuffers.reduce((sum, b) => sum + b.byteLength, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const buf of audioBuffers) {
        merged.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }
      const blobs = await splitAudioAtCutPoints(merged.buffer, cutTimes);

      setStatusText('Enviando áudios das sub-cenas...');
      const flatSubs = flattenSubScenes();
      await uploadSubSceneAudios(blobs, flatSubs);

      await supabase.from('projects').update({ status: 'audio_done', updated_at: new Date().toISOString() }).eq('id', project.id);
      onUpdate({ status: 'audio_done' });
      toast({ title: 'Áudios importados!' });
    } catch (err: any) {
      toast({ title: 'Erro ao importar áudio', description: err.message, variant: 'destructive' });
    } finally {
      setUploadingAudio(false);
      setStatusText('');
    }
  };

  const handleGenerateSingleImage = async (segIndex: number, subSceneId?: string) => {
    const seg = segments[segIndex];
    if (!subSceneId) return;

    const sc = seg.sub_scenes?.find(s => s.id === subSceneId);
    if (!sc) return;

    setGenSubSceneId(subSceneId);
    updateSubSceneInSegments(seg.id, subSceneId, { image_status: 'generating' });
    try {
      const { data, error } = await supabase.functions.invoke('generate-image', {
        body: {
          imagePrompt: sc.image_prompt,
          projectId: project.id,
          segmentId: seg.id,
          sequenceNumber: seg.sequence_number,
          subIndex: sc.sub_index,
          momentType: seg.moment_type,
        },
      });
      if (error) throw error;
      updateSubSceneInSegments(seg.id, subSceneId, { image_url: data.imageUrl, image_status: 'done' });
      await supabase.from('sub_scenes').update({ image_url: data.imageUrl, image_status: 'done' }).eq('id', subSceneId);
    } catch {
      updateSubSceneInSegments(seg.id, subSceneId, { image_status: 'error' });
    } finally {
      setGenSubSceneId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* HUD */}
      <div className="sticky top-14 z-40 rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold">Geração de Mídia</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleRegeneratePrompts} disabled={regenerating}>
            {regenerating ? <Loader2 className="animate-spin h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}
            Regenerar Prompts
          </Button>
          <Button variant="outline" size="sm" onClick={handleGenerateAllImages} disabled={generatingImages}>
            {generatingImages ? <Loader2 className="animate-spin h-3 w-3" /> : <Image className="h-3 w-3" />}
            Gerar Todas Imagens
          </Button>
          <Button variant="outline" size="sm" onClick={handleGenerateAllAudios} disabled={generatingAudios}>
            {generatingAudios ? <Loader2 className="animate-spin h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            Gerar Todos Áudios
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowImportDialog(true)} disabled={uploadingAudio}>
            {uploadingAudio ? <Loader2 className="animate-spin h-3 w-3" /> : <Upload className="h-3 w-3" />}
            Enviar Áudio
          </Button>
          <AudioImportDialog
            open={showImportDialog}
            onOpenChange={setShowImportDialog}
            onConfirm={handleUploadAudio}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Imagens {subScenesDone}/{totalSubScenes}</span>
            <Progress value={totalSubScenes > 0 ? (subScenesDone / totalSubScenes) * 100 : 0} className="mt-1" />
          </div>
          <div>
            <span className="text-muted-foreground">Áudios {subAudiosDone}/{totalSubScenes}</span>
            <Progress value={totalSubScenes > 0 ? (subAudiosDone / totalSubScenes) * 100 : 0} className="mt-1" />
          </div>
        </div>
        {statusText && <p className="text-xs text-muted-foreground">{statusText}</p>}
        {allDone && (
          <Button className="w-full" onClick={onNext}>
            Export <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Segment list */}
      <div className="space-y-2">
        {segments.map((seg, i) => (
          <SegmentCard
            key={seg.id}
            segment={seg}
            showMedia
            onUpdate={updates => updateSegment(i, updates)}
            onGenerateImage={(subSceneId) => handleGenerateSingleImage(i, subSceneId)}
            generatingImage={false}
            generatingSubSceneId={genSubSceneId}
          />
        ))}
      </div>
    </div>
  );
}

function mergeAlignments(alignments: Alignment[]): Alignment {
  const merged: Alignment = { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] };
  let timeOffset = 0;
  for (const a of alignments) {
    for (let i = 0; i < a.characters.length; i++) {
      merged.characters.push(a.characters[i]);
      merged.character_start_times_seconds.push(a.character_start_times_seconds[i] + timeOffset);
      merged.character_end_times_seconds.push(a.character_end_times_seconds[i] + timeOffset);
    }
    if (a.character_end_times_seconds.length > 0) {
      timeOffset = merged.character_end_times_seconds[merged.character_end_times_seconds.length - 1];
    }
  }
  return merged;
}
