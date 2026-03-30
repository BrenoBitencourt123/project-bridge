import { useState, useEffect, useCallback } from 'react';
import { Volume2, RefreshCw, Upload, ArrowRight, Loader2, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Project, Segment, SubScene } from '@/types/atlas';
import { useToast } from '@/hooks/use-toast';
import { splitAudioAtCutPoints, splitChunkedAudioAtCutPoints } from '@/lib/audio-splitter';
import { findSubSceneCutPoints } from '@/lib/find-cut-points';
import { AudioImportDialog } from './AudioImportDialog';
import { Textarea } from '@/components/ui/textarea';
import type { Alignment } from '@/types/atlas';

interface MediaStepProps {
  project: Project;
  segments: Segment[];
  onSegmentsChange: (segments: Segment[] | ((prev: Segment[]) => Segment[])) => void;
  onUpdate: (updates: Partial<Project>) => void;
  onNext: () => void;
  onGeneratingChange?: (generating: boolean) => void;
}

function buildPromptsText(segments: Segment[]): string {
  return segments.map(seg => {
    const num = String(seg.sequence_number).padStart(2, '0');
    const subScenes = (seg.sub_scenes || []).sort((a, b) => a.sub_index - b.sub_index);
    const header = `CENA ${num}: ${seg.narration.slice(0, 60)}`;
    const subs = subScenes.map(sc =>
      `  SUBCENA ${num}.${sc.sub_index}: ${sc.image_prompt || '(sem prompt)'}`
    ).join('\n');
    return `${header}\n${subs}`;
  }).join('\n\n');
}

export function MediaStep({ project, segments, onSegmentsChange, onUpdate, onNext, onGeneratingChange }: MediaStepProps) {
  const { toast } = useToast();
  const [generatingAudios, setGeneratingAudios] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [copied, setCopied] = useState(false);

  const allSubScenes = segments.flatMap(s => s.sub_scenes || []);
  const subAudiosDone = allSubScenes.filter(sc => sc.audio_status === 'done').length;
  const totalSubScenes = allSubScenes.length;
  const allAudiosDone = subAudiosDone === totalSubScenes && totalSubScenes > 0;

  const isAnyGenerating = generatingAudios || regenerating || uploadingAudio;

  const promptsText = buildPromptsText(segments);

  useEffect(() => {
    const segmentIds = segments.map(s => s.id);
    if (segmentIds.length === 0) return;
    const channel = supabase
      .channel(`sub-scenes-progress-${project.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sub_scenes' }, (payload) => {
        const updated = payload.new as SubScene;
        if (!segmentIds.includes(updated.segment_id)) return;
        onSegmentsChange(prev =>
          prev.map(seg => {
            if (seg.id !== updated.segment_id) return seg;
            return { ...seg, sub_scenes: (seg.sub_scenes || []).map(sc => sc.id === updated.id ? { ...sc, ...updated } : sc) };
          })
        );
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [project.id, segments.map(s => s.id).join(',')]);

  const updateSubSceneInSegments = useCallback((segmentId: string, subSceneId: string, updates: Partial<SubScene>) => {
    onSegmentsChange(prev =>
      prev.map(seg => {
        if (seg.id !== segmentId) return seg;
        return { ...seg, sub_scenes: (seg.sub_scenes || []).map(sc => sc.id === subSceneId ? { ...sc, ...updates } : sc) };
      })
    );
  }, [onSegmentsChange]);

  const handleRegeneratePrompts = async () => {
    setRegenerating(true);
    try {
      const segmentPayload = segments.map(s => ({
        narration: s.narration,
        momentType: s.moment_type,
        sequenceNumber: s.sequence_number,
        subScenes: (s.sub_scenes || [])
          .sort((a, b) => a.sub_index - b.sub_index)
          .map(sc => ({ subIndex: sc.sub_index, narration: sc.narration_segment })),
      }));

      const { data, error } = await supabase.functions.invoke('regenerate-prompts', {
        body: { segments: segmentPayload },
      });
      if (error) throw error;

      let promptIdx = 0;
      const updated = segments.map(s => {
        const subScenes = (s.sub_scenes || []).sort((a, b) => a.sub_index - b.sub_index);
        if (subScenes.length === 0) {
          const p = data.prompts[promptIdx++];
          return { ...s, image_prompt: p?.imagePrompt || s.image_prompt, symbolism: p?.symbolism || s.symbolism };
        }
        const updatedSubScenes = subScenes.map(sc => {
          const p = data.prompts[promptIdx++];
          return { ...sc, image_prompt: p?.imagePrompt || sc.image_prompt };
        });
        const firstPrompt = data.prompts[promptIdx - subScenes.length];
        return { ...s, symbolism: firstPrompt?.symbolism || s.symbolism, sub_scenes: updatedSubScenes };
      });

      onSegmentsChange(updated);

      for (const seg of updated) {
        await supabase.from('segments').update({ symbolism: seg.symbolism }).eq('id', seg.id);
        for (const sc of (seg.sub_scenes || [])) {
          if (sc.image_prompt) {
            await supabase.from('sub_scenes').update({ image_prompt: sc.image_prompt }).eq('id', sc.id);
          }
        }
      }

      toast({ title: 'Prompts regenerados por sub-cena!' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setRegenerating(false);
    }
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
    onGeneratingChange?.(true);
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
      onGeneratingChange?.(false);
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
      for (const buf of audioBuffers) { merged.set(new Uint8Array(buf), offset); offset += buf.byteLength; }
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

  const handleCopyPrompts = async () => {
    await navigator.clipboard.writeText(promptsText);
    setCopied(true);
    toast({ title: 'Prompts copiados!' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* HUD */}
      <div className="sticky top-14 z-40 rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Mídia & Prompts</h3>
            <p className="text-xs text-muted-foreground">
              🔊 {subAudiosDone}/{totalSubScenes} áudios · 🖼 {totalSubScenes} prompts de imagem
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRegeneratePrompts} disabled={isAnyGenerating}>
              {regenerating ? <Loader2 className="animate-spin h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}
              Regenerar Prompts
            </Button>
            <Button variant="outline" size="sm" onClick={handleGenerateAllAudios} disabled={isAnyGenerating}>
              {generatingAudios ? <Loader2 className="animate-spin h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
              Gerar Áudios
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowImportDialog(true)} disabled={isAnyGenerating}>
              <Upload className="h-3 w-3" /> Enviar Áudio
            </Button>
            <AudioImportDialog open={showImportDialog} onOpenChange={setShowImportDialog} onConfirm={handleUploadAudio} />
          </div>
        </div>

        {generatingAudios && <Progress value={audioProgress} className="h-2" />}
        {statusText && <p className="text-xs text-muted-foreground animate-pulse">{statusText}</p>}

        {allAudiosDone && (
          <Button className="w-full" onClick={onNext}>
            Export <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Prompts textarea */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Prompts de Imagem</h4>
          <Button variant="outline" size="sm" onClick={handleCopyPrompts}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copiado!' : 'Copiar Prompts'}
          </Button>
        </div>
        <Textarea
          readOnly
          value={promptsText}
          className="min-h-[300px] font-mono text-xs leading-relaxed"
        />
      </div>

      {/* Audio list per segment */}
      <div className="space-y-2">
        {segments.map(seg => {
          const subScenes = (seg.sub_scenes || []).sort((a, b) => a.sub_index - b.sub_index);
          return (
            <div key={seg.id} className="rounded-lg border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-mono text-muted-foreground">{String(seg.sequence_number).padStart(3, '0')}</span>
                <p className="flex-1 text-xs text-muted-foreground line-clamp-1">{seg.narration.slice(0, 80)}</p>
              </div>
              <div className="p-2 space-y-1">
                {subScenes.map(sc => (
                  <div key={sc.id} className="flex items-center gap-2 px-2 py-1 text-xs">
                    <span className="font-mono text-muted-foreground">Sub {sc.sub_index}</span>
                    <StatusDot status={sc.audio_status} />
                    <span className="flex-1 truncate text-muted-foreground">{sc.narration_segment.slice(0, 60)}</span>
                    {sc.audio_url && <audio controls src={sc.audio_url} className="h-6 w-48" />}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: 'bg-muted-foreground/40',
    generating: 'bg-yellow-500 animate-pulse',
    done: 'bg-green-500',
    error: 'bg-destructive',
  };
  return <div className={`h-2 w-2 rounded-full ${colors[status] || colors.idle}`} />;
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
