import { useState } from 'react';
import { ChevronDown, Image, Volume2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Segment, SubScene, MOMENT_TYPE_CONFIG } from '@/types/atlas';

interface SegmentCardProps {
  segment: Segment;
  showMedia?: boolean;
  onUpdate: (updates: Partial<Segment>) => void;
  onGenerateImage?: (subSceneId?: string) => void;
  generatingImage?: boolean;
  generatingSubSceneId?: string | null;
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: 'bg-muted-foreground/40',
    generating: 'bg-warning animate-pulse-dot',
    done: 'bg-success',
    error: 'bg-destructive',
  };
  return <div className={cn('h-2.5 w-2.5 rounded-full', colors[status] || colors.idle)} />;
}

function SubSceneCard({
  subScene,
  showMedia,
  onUpdate,
  onGenerateImage,
  generating,
}: {
  subScene: SubScene;
  showMedia?: boolean;
  onUpdate: (updates: Partial<SubScene>) => void;
  onGenerateImage?: () => void;
  generating?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/30 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px]">Sub {subScene.sub_index}</Badge>
        <StatusDot status={subScene.image_status} />
        <StatusDot status={subScene.audio_status} />
        <span className="text-xs text-muted-foreground truncate flex-1">{subScene.narration_segment.slice(0, 50)}...</span>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Narração da sub-cena</label>
        <Textarea
          value={subScene.narration_segment}
          onChange={e => onUpdate({ narration_segment: e.target.value })}
          rows={2}
          className="text-xs"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Prompt da imagem</label>
        <Textarea
          value={subScene.image_prompt || ''}
          onChange={e => onUpdate({ image_prompt: e.target.value })}
          rows={2}
          className="text-xs"
        />
      </div>

      {showMedia && (
        <div className="space-y-2">
          {subScene.image_url && (
            <img src={subScene.image_url} alt={`Sub-cena ${subScene.sub_index}`} className="rounded-md max-h-32 object-contain" />
          )}
          {subScene.audio_url && (
            <audio controls src={subScene.audio_url} className="w-full h-8" />
          )}
          {onGenerateImage && (
            <Button variant="outline" size="sm" onClick={onGenerateImage} disabled={generating} className="text-xs h-7">
              {generating ? <Loader2 className="animate-spin h-3 w-3" /> : <Image className="h-3 w-3" />}
              Gerar Imagem
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function SegmentCard({
  segment,
  showMedia,
  onUpdate,
  onGenerateImage,
  generatingImage,
  generatingSubSceneId,
}: SegmentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const momentCfg = segment.moment_type ? MOMENT_TYPE_CONFIG[segment.moment_type] : null;
  const subScenes = segment.sub_scenes || [];

  const updateSubScene = (subIndex: number, updates: Partial<SubScene>) => {
    if (!segment.sub_scenes) return;
    const updatedSubs = segment.sub_scenes.map((sc, i) =>
      i === subIndex ? { ...sc, ...updates } : sc
    );
    onUpdate({ sub_scenes: updatedSubs });
  };

  const subImagesDone = subScenes.filter(sc => sc.image_status === 'done').length;
  const subAudiosDone = subScenes.filter(sc => sc.audio_status === 'done').length;
  const subImagesTotal = subScenes.length;

  return (
    <div className="rounded-lg border bg-card">
      <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setExpanded(!expanded)}>
        <span className="text-xs font-mono text-muted-foreground w-8">{String(segment.sequence_number).padStart(3, '0')}</span>
        {momentCfg && <Badge className={`text-[10px] ${momentCfg.color}`}>{momentCfg.label}</Badge>}
        <p className="flex-1 text-sm line-clamp-2">{segment.narration}</p>
        <div className="flex items-center gap-1.5">
          {subImagesTotal > 0 && (
            <>
              <span className="text-[10px] text-muted-foreground">🖼 {subImagesDone}/{subImagesTotal}</span>
              <span className="text-[10px] text-muted-foreground">🔊 {subAudiosDone}/{subImagesTotal}</span>
            </>
          )}
        </div>
        <ChevronDown className={cn('h-4 w-4 transition-transform text-muted-foreground', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t px-3 pb-3 pt-3 space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Narração do bloco</label>
            <Textarea value={segment.narration} onChange={e => onUpdate({ narration: e.target.value })} rows={3} className="text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Prompt base da imagem</label>
            <Textarea value={segment.image_prompt || ''} onChange={e => onUpdate({ image_prompt: e.target.value })} rows={2} className="text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Simbolismo</label>
            <Input value={segment.symbolism || ''} onChange={e => onUpdate({ symbolism: e.target.value })} className="text-sm" />
          </div>

          {subScenes.length > 0 && (
            <div className="space-y-2 pt-2">
              <label className="text-xs font-medium text-muted-foreground">Sub-cenas ({subScenes.length})</label>
              {subScenes.map((sc, i) => (
                <SubSceneCard
                  key={sc.id}
                  subScene={sc}
                  showMedia={showMedia}
                  onUpdate={updates => updateSubScene(i, updates)}
                  onGenerateImage={onGenerateImage ? () => onGenerateImage(sc.id) : undefined}
                  generating={generatingSubSceneId === sc.id}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
