import { useState, useEffect, useCallback } from 'react';
import { Volume2, RefreshCw, Upload, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Project, Segment, SubScene } from '@/types/atlas';
import { useToast } from '@/hooks/use-toast';
import { splitAudioAtCutPoints } from '@/lib/audio-splitter';
import { AudioImportDialog } from './AudioImportDialog';

interface MediaStepProps {
  project: Project;
  segments: Segment[];
  onSegmentsChange: (segments: Segment[] | ((prev: Segment[]) => Segment[])) => void;
  onUpdate: (updates: Partial<Project>) => void;
  onNext: () => void;
  onGeneratingChange?: (generating: boolean) => void;
}

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface AudioSubScene {
  narration_segment: string;
  image_prompt: string;
  start_time: number;
  end_time: number;
}

interface SegmentedAudio {
  segment_id: string;
  sub_scenes: AudioSubScene[];
}

export function MediaStep({ project, segments, onSegmentsChange, onUpdate, onNext, onGeneratingChange }: MediaStepProps) {
  const { toast } = useToast();
  const [generatingAudios, setGeneratingAudios] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [statusText, setStatusText] = useState('');

  const allSubScenes = segments.flatMap(s => s.sub_scenes || []);
  const subAudiosDone = allSubScenes.filter(sc => sc.audio_status === 'done').length;
  const totalSubScenes = allSubScenes.length;
  const allAudiosDone = subAudiosDone === totalSubScenes && totalSubScenes > 0;
  const isAnyGenerating = generatingAudios || regenerating || uploadingAudio;

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

  // Replace existing sub_scenes in DB with AI-segmented ones, then cut and upload audio
  const applyAudioSegmentation = async (
    segmentedSubScenes: SegmentedAudio[],
    audioBuffer: ArrayBuffer,
    totalDuration: number,
  ) => {
    // Delete existing sub_scenes
    setStatusText('Recriando sub-cenas pela IA...');
    const allSegmentIds = segments.map(s => s.id);
    await supabase.from('sub_scenes').delete().in('segment_id', allSegmentIds);

    // Insert new sub_scenes and track them with their timing info
    type SubSceneWithTiming = SubScene & { _start: number; _end: number };
    const insertedSubScenes: SubSceneWithTiming[] = [];

    for (const segGroup of segmentedSubScenes) {
      for (let i = 0; i < segGroup.sub_scenes.length; i++) {
        const sc = segGroup.sub_scenes[i];
        const { data: inserted, error: insertErr } = await supabase
          .from('sub_scenes')
          .insert({
            segment_id: segGroup.segment_id,
            sub_index: i + 1,
            narration_segment: sc.narration_segment,
            image_prompt: sc.image_prompt,
            audio_status: 'idle',
            image_status: 'idle',
          })
          .select()
          .single();
        if (insertErr) throw insertErr;
        insertedSubScenes.push({ ...(inserted as SubScene), _start: sc.start_time, _end: sc.end_time });
      }
    }

    // Update local state
    onSegmentsChange(segments.map(seg => ({
      ...seg,
      sub_scenes: insertedSubScenes
        .filter(sc => sc.segment_id === seg.id)
        .map(({ _start: _, _end: __, ...sc }) => sc as SubScene),
    })));

    // Cut audio at start_times (except first sub-scene which starts at 0)
    setStatusText('Fatiando áudio por sub-cena...');
    const cutTimes = insertedSubScenes.slice(1).map(sc => sc._start);
    const blobs = await splitAudioAtCutPoints(audioBuffer, cutTimes);

    // Upload each blob
    setStatusText('Enviando áudios das sub-cenas...');
    for (let i = 0; i < blobs.length && i < insertedSubScenes.length; i++) {
      const sc = insertedSubScenes[i];
      const seg = segments.find(s => s.id === sc.segment_id);
      if (!seg) continue;
      const num = String(seg.sequence_number).padStart(3, '0');
      const fileName = `${project.id}/segment-${num}-sub-${sc.sub_index}.wav`;
      const { error: uploadErr } = await supabase.storage
        .from('segment-audio')
        .upload(fileName, blobs[i], { upsert: true, contentType: 'audio/wav' });
      if (uploadErr) { console.error(uploadErr); continue; }
      const { data: urlData } = supabase.storage.from('segment-audio').getPublicUrl(fileName);
      const audioUrl = urlData.publicUrl + `?t=${Date.now()}`;
      await supabase.from('sub_scenes').update({ audio_url: audioUrl, audio_status: 'done' }).eq('id', sc.id);
      updateSubSceneInSegments(sc.segment_id, sc.id, { audio_url: audioUrl, audio_status: 'done' });
      setAudioProgress(((i + 1) / insertedSubScenes.length) * 100);
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

      // Convert ElevenLabs character-level alignment to word timestamps
      setStatusText('Segmentando áudio com IA...');
      const alignment = data.isChunked
        ? mergeCharAlignments(data.chunks.map((c: any) => c.alignment))
        : data.alignment;
      const wordTimestamps = charAlignmentToWordTimestamps(alignment);
      const totalDuration = alignment.character_end_times_seconds[alignment.character_end_times_seconds.length - 1] || 0;

      const { data: segData, error: segError } = await supabase.functions.invoke('segment-audio', {
        body: {
          wordTimestamps,
          fullText: wordTimestamps.map((w: WordTimestamp) => w.word).join(' '),
          totalDuration,
          segments: segments.map(s => ({ id: s.id, sequence_number: s.sequence_number, narration: s.narration, moment_type: s.moment_type })),
        },
      });
      if (segError) throw segError;

      // Decode full audio
      let audioBytes: Uint8Array;
      if (data.isChunked) {
        const arrays: Uint8Array[] = data.chunks.map((c: any) =>
          Uint8Array.from(atob(c.audioBase64), (ch: string) => ch.charCodeAt(0))
        );
        const total = arrays.reduce((s, a) => s + a.length, 0);
        audioBytes = new Uint8Array(total);
        let off = 0;
        for (const arr of arrays) { audioBytes.set(arr, off); off += arr.length; }
      } else {
        audioBytes = Uint8Array.from(atob(data.fullAudioBase64), c => c.charCodeAt(0));
      }

      await applyAudioSegmentation(segData.segmentedSubScenes, audioBytes.buffer, totalDuration);

      await supabase.from('projects').update({ status: 'audio_done', updated_at: new Date().toISOString() }).eq('id', project.id);
      onUpdate({ status: 'audio_done' });
      toast({ title: 'Áudios gerados e sub-cenas criadas pela IA!' });
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
    setAudioProgress(0);
    try {
      // Step 1: Transcribe all files, collecting word timestamps with time offset
      const allWordTimestamps: WordTimestamp[] = [];
      const audioBuffers: ArrayBuffer[] = [];
      let totalDuration = 0;

      for (let i = 0; i < orderedFiles.length; i++) {
        setStatusText(`Transcrevendo parte ${i + 1} de ${orderedFiles.length}...`);
        const formData = new FormData();
        formData.append('audio', orderedFiles[i]);
        const { data, error } = await supabase.functions.invoke('transcribe-audio', { body: formData });
        if (error) throw error;

        const offsetWords = (data.wordTimestamps as WordTimestamp[]).map(w => ({
          word: w.word,
          start: w.start + totalDuration,
          end: w.end + totalDuration,
        }));
        allWordTimestamps.push(...offsetWords);
        totalDuration += data.totalDuration as number;
        audioBuffers.push(await orderedFiles[i].arrayBuffer());
      }

      // Step 2: AI segmentation
      setStatusText('Segmentando áudio com IA...');
      const { data: segData, error: segError } = await supabase.functions.invoke('segment-audio', {
        body: {
          wordTimestamps: allWordTimestamps,
          fullText: allWordTimestamps.map(w => w.word).join(' '),
          totalDuration,
          segments: segments.map(s => ({
            id: s.id,
            sequence_number: s.sequence_number,
            narration: s.narration,
            moment_type: s.moment_type,
          })),
        },
      });
      if (segError) throw segError;

      // Step 3: Merge audio buffers into one
      const totalLength = audioBuffers.reduce((sum, b) => sum + b.byteLength, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const buf of audioBuffers) { merged.set(new Uint8Array(buf), offset); offset += buf.byteLength; }

      // Step 4: Apply segmentation (delete old sub-scenes, create new, cut & upload audio)
      await applyAudioSegmentation(segData.segmentedSubScenes, merged.buffer, totalDuration);

      await supabase.from('projects').update({ status: 'audio_done', updated_at: new Date().toISOString() }).eq('id', project.id);
      onUpdate({ status: 'audio_done' });
      toast({ title: 'Áudio importado e sub-cenas criadas pela IA!' });
    } catch (err: any) {
      toast({ title: 'Erro ao importar áudio', description: err.message, variant: 'destructive' });
    } finally {
      setUploadingAudio(false);
      setStatusText('');
    }
  };

  return (
    <div className="space-y-4">
      {/* HUD */}
      <div className="sticky top-14 z-40 rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Mídia & Prompts</h3>
            <p className="text-xs text-muted-foreground">
              🔊 {subAudiosDone}/{totalSubScenes} áudios · 🖼 {totalSubScenes} sub-cenas
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

        {(generatingAudios || uploadingAudio) && <Progress value={audioProgress} className="h-2" />}
        {statusText && <p className="text-xs text-muted-foreground animate-pulse">{statusText}</p>}

        {allAudiosDone && (
          <Button className="w-full" onClick={onNext}>
            Export <ArrowRight className="h-4 w-4" />
          </Button>
        )}
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

// Convert ElevenLabs character-level alignment to word timestamps
function charAlignmentToWordTimestamps(alignment: {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  let wordChars: string[] = [];
  let wordStart = 0;
  let wordEnd = 0;

  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i];
    if (ch === ' ' || ch === '\n') {
      if (wordChars.length > 0) {
        words.push({ word: wordChars.join(''), start: wordStart, end: wordEnd });
        wordChars = [];
      }
    } else {
      if (wordChars.length === 0) wordStart = alignment.character_start_times_seconds[i];
      wordChars.push(ch);
      wordEnd = alignment.character_end_times_seconds[i];
    }
  }
  if (wordChars.length > 0) {
    words.push({ word: wordChars.join(''), start: wordStart, end: wordEnd });
  }
  return words;
}

// Merge ElevenLabs character-level alignments across chunks
function mergeCharAlignments(alignments: {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}[]): typeof alignments[0] {
  const merged = { characters: [] as string[], character_start_times_seconds: [] as number[], character_end_times_seconds: [] as number[] };
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

