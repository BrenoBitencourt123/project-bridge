import { useState, useEffect, useCallback } from 'react';
import { Image, Volume2, RefreshCw, Upload, ArrowRight, Loader2, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Project, Segment, SubScene } from '@/types/atlas';
import { StyleTemplateSelector } from './StyleTemplateSelector';
import { useToast } from '@/hooks/use-toast';
import { splitAudioAtCutPoints, splitChunkedAudioAtCutPoints } from '@/lib/audio-splitter';
import { findSubSceneCutPoints } from '@/lib/find-cut-points';
import { AudioImportDialog } from './AudioImportDialog';
import { AssetReferenceSelector, type AssetReference } from './AssetReferenceSelector';
import { CostEstimateCard } from './CostEstimateCard';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MOMENT_TYPE_CONFIG } from '@/types/atlas';
import type { Alignment } from '@/types/atlas';

interface MediaStepProps {
  project: Project;
  segments: Segment[];
  onSegmentsChange: (segments: Segment[] | ((prev: Segment[]) => Segment[])) => void;
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
  const [styleTemplateId, setStyleTemplateId] = useState<string | null>(null);
  const [stylePrefix, setStylePrefix] = useState<string>('');
  const [selectedAssets, setSelectedAssets] = useState<AssetReference[]>([]);

  const allSubScenes = segments.flatMap(s => s.sub_scenes || []);
  const subScenesDone = allSubScenes.filter(sc => sc.image_status === 'done').length;
  const subAudiosDone = allSubScenes.filter(sc => sc.audio_status === 'done').length;
  const totalSubScenes = allSubScenes.length;
  const allDone = subScenesDone === totalSubScenes && subAudiosDone === totalSubScenes && totalSubScenes > 0;

  const totalProgress = totalSubScenes > 0 ? ((subScenesDone + subAudiosDone) / (totalSubScenes * 2)) * 100 : 0;

  const isAnyGenerating = generatingImages || generatingAudios || regenerating || uploadingAudio;

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
    onGeneratingChange?.(true);
    setImageProgress(0);
    let done = 0;
    for (const seg of segments) {
      for (const sc of (seg.sub_scenes || [])) {
        if (sc.image_status === 'done') { done++; setImageProgress((done / totalSubScenes) * 100); continue; }
        updateSubSceneInSegments(seg.id, sc.id, { image_status: 'generating' });
        try {
          const { data, error } = await supabase.functions.invoke('generate-image', {
            body: {
              imagePrompt: sc.image_prompt, projectId: project.id, segmentId: seg.id,
              sequenceNumber: seg.sequence_number, subIndex: sc.sub_index, momentType: seg.moment_type,
              stylePrefix, assetDescriptions: selectedAssets.map(a => ({ name: a.name, description: a.description, category: a.category })),
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
    onGeneratingChange?.(false);
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

  const handleGenerateSingleImage = async (seg: Segment, sc: SubScene) => {
    setGenSubSceneId(sc.id);
    updateSubSceneInSegments(seg.id, sc.id, { image_status: 'generating' });
    try {
      const { data, error } = await supabase.functions.invoke('generate-image', {
        body: {
          imagePrompt: sc.image_prompt, projectId: project.id, segmentId: seg.id,
          sequenceNumber: seg.sequence_number, subIndex: sc.sub_index, momentType: seg.moment_type,
          stylePrefix, assetDescriptions: selectedAssets.map(a => ({ name: a.name, description: a.description, category: a.category })),
        },
      });
      if (error) throw error;
      updateSubSceneInSegments(seg.id, sc.id, { image_url: data.imageUrl, image_status: 'done' });
      await supabase.from('sub_scenes').update({ image_url: data.imageUrl, image_status: 'done' }).eq('id', sc.id);
    } catch {
      updateSubSceneInSegments(seg.id, sc.id, { image_status: 'error' });
    } finally {
      setGenSubSceneId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Compact HUD */}
      <div className="sticky top-14 z-40 rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Geração de Mídia</h3>
            <p className="text-xs text-muted-foreground">
              🖼 {subScenesDone}/{totalSubScenes} imagens · 🔊 {subAudiosDone}/{totalSubScenes} áudios
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AssetReferenceSelector selectedAssets={selectedAssets} onSelectionChange={setSelectedAssets} />
            <StyleTemplateSelector value={styleTemplateId} onChange={(id, prefix) => { setStyleTemplateId(id); setStylePrefix(prefix); }} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={isAnyGenerating}>
                  {isAnyGenerating ? <Loader2 className="animate-spin h-3 w-3" /> : <MoreVertical className="h-3 w-3" />}
                  Ações
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleRegeneratePrompts} disabled={regenerating}>
                  <RefreshCw className="h-3 w-3 mr-2" /> Regenerar Prompts
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleGenerateAllImages} disabled={generatingImages}>
                  <Image className="h-3 w-3 mr-2" /> Gerar Todas Imagens
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleGenerateAllAudios} disabled={generatingAudios}>
                  <Volume2 className="h-3 w-3 mr-2" /> Gerar Todos Áudios
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowImportDialog(true)} disabled={uploadingAudio}>
                  <Upload className="h-3 w-3 mr-2" /> Enviar Áudio
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <AudioImportDialog open={showImportDialog} onOpenChange={setShowImportDialog} onConfirm={handleUploadAudio} />
          </div>
        </div>

        <Progress value={totalProgress} className="h-2" />

        <CostEstimateCard
          charCount={allSubScenes.reduce((sum, sc) => sum + (sc.narration_segment?.length || 0), 0)}
          subSceneCount={totalSubScenes}
        />

        {statusText && <p className="text-xs text-muted-foreground animate-pulse">{statusText}</p>}

        {allDone && (
          <Button className="w-full" onClick={onNext}>
            Export <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Sub-scenes grid view per segment */}
      <div className="space-y-4">
        {segments.map((seg) => {
          const momentCfg = seg.moment_type ? MOMENT_TYPE_CONFIG[seg.moment_type] : null;
          const subScenes = (seg.sub_scenes || []).sort((a, b) => a.sub_index - b.sub_index);

          return (
            <div key={seg.id} className="rounded-lg border bg-card overflow-hidden">
              {/* Segment header */}
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-mono text-muted-foreground">{String(seg.sequence_number).padStart(3, '0')}</span>
                {momentCfg && <Badge className={`text-[10px] ${momentCfg.color}`}>{momentCfg.label}</Badge>}
                <p className="flex-1 text-xs text-muted-foreground line-clamp-1">{seg.narration.slice(0, 80)}...</p>
                <span className="text-[10px] text-muted-foreground">{subScenes.length} sub-cenas</span>
              </div>

              {/* Sub-scenes grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 p-2">
                {subScenes.map((sc) => {
                  const isGenThisOne = genSubSceneId === sc.id;
                  return (
                    <div key={sc.id} className="rounded-md border border-border/50 bg-background overflow-hidden">
                      {/* Image area */}
                      <div className="aspect-video bg-muted/50 relative group">
                        {sc.image_status === 'generating' && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        {sc.image_url ? (
                          <img src={sc.image_url} alt={`Sub ${sc.sub_index}`} className="w-full h-full object-cover" />
                        ) : sc.image_status !== 'generating' ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs opacity-60 hover:opacity-100"
                              onClick={() => handleGenerateSingleImage(seg, sc)}
                              disabled={isGenThisOne}
                            >
                              <Image className="h-3 w-3 mr-1" /> Gerar
                            </Button>
                          </div>
                        ) : null}
                        {/* Regenerate button overlay on existing image */}
                        {sc.image_url && (
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Button
                              variant="secondary"
                              size="sm"
                              className="text-xs"
                              onClick={() => handleGenerateSingleImage(seg, sc)}
                              disabled={isGenThisOne}
                            >
                              <RefreshCw className="h-3 w-3 mr-1" /> Refazer
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="p-1.5 space-y-1">
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[9px] px-1 py-0">Sub {sc.sub_index}</Badge>
                          <StatusDot status={sc.image_status} />
                          <StatusDot status={sc.audio_status} />
                        </div>
                        <p className="text-[10px] text-muted-foreground line-clamp-2">{sc.narration_segment}</p>
                        {sc.audio_url && (
                          <audio controls src={sc.audio_url} className="w-full h-6" />
                        )}
                      </div>
                    </div>
                  );
                })}
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
