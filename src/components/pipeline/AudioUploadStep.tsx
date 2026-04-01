import { useState, useRef, useCallback } from 'react';
import { Upload, Music, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Project, Segment, SubScene } from '@/types/atlas';
import { useToast } from '@/hooks/use-toast';
import { splitAudioAtCutPoints } from '@/lib/audio-splitter';

interface AudioUploadStepProps {
  project: Project;
  onUpdate: (updates: Partial<Project>) => void;
  onSegmentsChange: (segments: Segment[]) => void;
  onNext: () => void;
}

type StageKey = 'idle' | 'transcribing' | 'analyzing' | 'cutting' | 'uploading' | 'done';

const STAGE_LABELS: Record<StageKey, string> = {
  idle: '',
  transcribing: 'Transcrevendo áudio...',
  analyzing: 'Analisando conteúdo com IA...',
  cutting: 'Cortando sub-cenas...',
  uploading: 'Enviando áudios...',
  done: 'Concluído!',
};

interface Summary {
  title: string;
  subject: string | null;
  topic: string | null;
  totalSegments: number;
  totalSubScenes: number;
  totalDuration: number;
}

export function AudioUploadStep({ project, onUpdate, onSegmentsChange, onNext }: AudioUploadStepProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<StageKey>('idle');
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);

  const processAudio = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setStage('transcribing');
    setProgress(10);

    try {
      // ── Step 1: Transcribe each file, collecting word timestamps with time offsets ──
      interface WordTimestamp { word: string; start: number; end: number; }
      const allWords: WordTimestamp[] = [];
      let timeOffset = 0;
      let fullText = '';
      const audioBuffers: ArrayBuffer[] = [];

      for (const file of files) {
        const formData = new FormData();
        formData.append('audio', file);
        const { data: txData, error: txErr } = await supabase.functions.invoke('transcribe-audio', { body: formData });
        if (txErr) throw new Error(`Transcrição falhou: ${txErr.message}`);

        const words: WordTimestamp[] = (txData.wordTimestamps || []).map((w: WordTimestamp) => ({
          word: w.word,
          start: w.start + timeOffset,
          end: w.end + timeOffset,
        }));

        allWords.push(...words);
        fullText += (fullText ? ' ' : '') + (txData.fullText || '');
        timeOffset += txData.totalDuration || 0;

        const buf = await file.arrayBuffer();
        audioBuffers.push(buf);
      }

      const totalDuration = timeOffset;

      // ── Step 2: Merge audio buffers ──
      const mergedBytes = mergeArrayBuffers(audioBuffers);

      // Convert merged audio to base64 for the edge function
      const audioBase64 = arrayBufferToBase64(mergedBytes);

      setProgress(30);
      setStage('analyzing');

      // ── Step 3: Call analyze-audio — saves to DB, returns segments + sub_scenes ──
      const { data: analyzeData, error: analyzeErr } = await supabase.functions.invoke('analyze-audio', {
        body: {
          projectId: project.id,
          wordTimestamps: allWords,
          fullText,
          totalDuration,
          audioBase64,
        },
      });
      if (analyzeErr) throw new Error(`Análise falhou: ${analyzeErr.message}`);

      setProgress(60);
      setStage('cutting');

      // ── Step 4: Cut audio at sub-scene boundaries ──
      const segments: Array<Record<string, unknown> & { sub_scenes: Array<Record<string, unknown> & { _start: number; _end: number }> }> = analyzeData.segments || [];
      const cutTimes: number[] = [];

      // Collect all cut points (start of each sub-scene except the very first)
      for (const seg of segments) {
        for (let i = 0; i < seg.sub_scenes.length; i++) {
          const sc = seg.sub_scenes[i];
          if (cutTimes.length === 0 && sc._start === 0) continue;
          if (!cutTimes.includes(sc._start)) cutTimes.push(sc._start);
        }
      }
      cutTimes.sort((a, b) => a - b);

      const audioBlobs = await splitAudioAtCutPoints(mergedBytes, cutTimes);

      setProgress(80);
      setStage('uploading');

      // ── Step 5: Upload each audio blob and update sub_scene record ──
      // Build a flat ordered list of sub_scenes with their blob index
      const orderedSubScenes: Array<{ segmentId: string; subSceneId: string; blobIndex: number }> = [];
      for (const seg of segments) {
        for (const sc of seg.sub_scenes) {
          orderedSubScenes.push({
            segmentId: seg.id as string,
            subSceneId: sc.id as string,
            blobIndex: orderedSubScenes.length,
          });
        }
      }

      const uploadedSegments: Segment[] = [];
      let uploadIdx = 0;

      for (const seg of segments) {
        const subScenesUpdated: SubScene[] = [];
        for (const sc of seg.sub_scenes) {
          const blob = audioBlobs[uploadIdx] ?? audioBlobs[audioBlobs.length - 1];
          const fileName = `${project.id}/${sc.id as string}.wav`;
          const { error: upErr } = await supabase.storage
            .from('segment-audio')
            .upload(fileName, blob, { upsert: true, contentType: 'audio/wav' });

          let audioUrl: string | null = null;
          if (!upErr) {
            const { data: urlData } = supabase.storage.from('segment-audio').getPublicUrl(fileName);
            audioUrl = urlData.publicUrl + `?t=${Date.now()}`;
            await supabase.from('sub_scenes').update({ audio_url: audioUrl, audio_status: 'done' }).eq('id', sc.id);
          } else {
            console.warn(`Upload falhou para sub_scene ${sc.id as string}:`, upErr);
          }

          subScenesUpdated.push({
            ...(sc as unknown as SubScene),
            audio_url: audioUrl,
            audio_status: upErr ? 'error' : 'done',
          });
          uploadIdx++;
        }

        uploadedSegments.push({
          ...(seg as unknown as Segment),
          sub_scenes: subScenesUpdated,
        });
      }

      setProgress(100);
      setStage('done');

      // ── Step 6: Update parent state ──
      onSegmentsChange(uploadedSegments);
      onUpdate({
        status: 'segmented',
        title: analyzeData.title || project.title,
        subject: analyzeData.subject || null,
        topic: analyzeData.topic || null,
      });

      // Persist title update
      await supabase.from('projects').update({
        status: 'segmented',
        title: analyzeData.title || project.title,
        subject: analyzeData.subject,
        topic: analyzeData.topic,
        updated_at: new Date().toISOString(),
      }).eq('id', project.id);

      setSummary({
        title: analyzeData.title || project.title,
        subject: analyzeData.subject || null,
        topic: analyzeData.topic || null,
        totalSegments: uploadedSegments.length,
        totalSubScenes: uploadedSegments.reduce((acc, s) => acc + (s.sub_scenes?.length || 0), 0),
        totalDuration,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      toast({ title: 'Erro ao processar áudio', description: msg, variant: 'destructive' });
      setStage('idle');
      setProgress(0);
    }
  }, [project.id, project.title, onUpdate, onSegmentsChange, toast]);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|m4a|ogg|flac|aac)$/i));
    if (!audioFiles.length) {
      toast({ title: 'Formato inválido', description: 'Envie arquivos de áudio (mp3, wav, m4a, etc.)', variant: 'destructive' });
      return;
    }
    processAudio(audioFiles);
  };

  const isProcessing = stage !== 'idle' && stage !== 'done';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Upload do Áudio</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Envie o áudio do seu vídeo. A IA vai entender o conteúdo e criar automaticamente os segmentos e sub-cenas.
        </p>
      </div>

      {stage === 'idle' && (
        <div
          className={`border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center gap-4 cursor-pointer transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30'
          }`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="rounded-full bg-primary/10 p-4">
            <Music className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center">
            <p className="font-medium">Arraste o áudio aqui ou clique para selecionar</p>
            <p className="text-sm text-muted-foreground mt-1">MP3, WAV, M4A, OGG, FLAC — um ou mais arquivos</p>
          </div>
          <Button variant="outline" size="sm" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>
            <Upload className="h-4 w-4" />
            Selecionar arquivo
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
        </div>
      )}

      {isProcessing && (
        <div className="border rounded-xl p-8 flex flex-col items-center gap-5">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <div className="w-full max-w-sm space-y-2 text-center">
            <p className="font-medium">{STAGE_LABELS[stage]}</p>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground">{progress}%</p>
          </div>
          {stage === 'analyzing' && (
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Identificando tema, arco narrativo, momentos pedagógicos e criando cortes com propósito...
            </p>
          )}
        </div>
      )}

      {stage === 'done' && summary && (
        <div className="border rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">Áudio processado com sucesso!</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Título detectado</p>
              <p className="font-medium mt-0.5">{summary.title}</p>
            </div>
            {(summary.subject || summary.topic) && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Assunto</p>
                <p className="font-medium mt-0.5">{[summary.subject, summary.topic].filter(Boolean).join(' · ')}</p>
              </div>
            )}
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Segmentos criados</p>
              <p className="font-medium mt-0.5">{summary.totalSegments} segmentos</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Sub-cenas criadas</p>
              <p className="font-medium mt-0.5">{summary.totalSubScenes} sub-cenas · ~{Math.round(summary.totalDuration)}s total</p>
            </div>
          </div>
          <Button className="w-full" onClick={onNext}>
            Continuar para Revisão <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mergeArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    merged.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return merged.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
