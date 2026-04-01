import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Project, Segment, SubScene } from '@/types/atlas';
import { useToast } from '@/hooks/use-toast';

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
  const [regenerating, setRegenerating] = useState(false);

  const allSubScenes = segments.flatMap(s => s.sub_scenes || []);
  const subAudiosDone = allSubScenes.filter(sc => sc.audio_status === 'done').length;
  const totalSubScenes = allSubScenes.length;

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
    onGeneratingChange?.(true);
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

      toast({ title: 'Prompts regenerados!' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setRegenerating(false);
      onGeneratingChange?.(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* HUD */}
      <div className="sticky top-14 z-40 rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Revisão de Sub-cenas</h3>
            <p className="text-xs text-muted-foreground">
              {subAudiosDone}/{totalSubScenes} áudios prontos · {totalSubScenes} sub-cenas
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRegeneratePrompts} disabled={regenerating}>
              {regenerating ? <Loader2 className="animate-spin h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}
              Regenerar Prompts
            </Button>
          </div>
        </div>

        {totalSubScenes > 0 && (
          <Button className="w-full" onClick={onNext}>
            Continuar para Export <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Sub-scene list per segment */}
      <div className="space-y-2">
        {segments.map(seg => {
          const subScenes = (seg.sub_scenes || []).sort((a, b) => a.sub_index - b.sub_index);
          return (
            <div key={seg.id} className="rounded-lg border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-mono text-muted-foreground">{String(seg.sequence_number).padStart(3, '0')}</span>
                <p className="flex-1 text-xs font-medium truncate">{seg.narration.slice(0, 80)}</p>
              </div>
              <div className="p-2 space-y-1">
                {subScenes.map(sc => (
                  <div key={sc.id} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted/30">
                    <span className="font-mono text-muted-foreground w-10 shrink-0">Sub {sc.sub_index}</span>
                    <StatusDot status={sc.audio_status} />
                    <span className="flex-1 truncate text-muted-foreground">{sc.narration_segment.slice(0, 70)}</span>
                    {sc.audio_url && <audio controls src={sc.audio_url} className="h-6 w-44 shrink-0" />}
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
  return <div className={`h-2 w-2 rounded-full shrink-0 ${colors[status] || colors.idle}`} />;
}
