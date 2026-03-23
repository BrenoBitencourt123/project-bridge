import { useState } from 'react';
import { ChevronDown, Image, Volume2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Segment, MOMENT_TYPE_CONFIG } from '@/types/atlas';

interface SegmentCardProps {
  segment: Segment;
  showMedia?: boolean;
  onUpdate: (updates: Partial<Segment>) => void;
  onGenerateImage?: () => void;
  onGenerateAudio?: () => void;
  generatingImage?: boolean;
  generatingAudio?: boolean;
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

export function SegmentCard({ segment, showMedia, onUpdate, onGenerateImage, onGenerateAudio, generatingImage, generatingAudio }: SegmentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const momentCfg = segment.moment_type ? MOMENT_TYPE_CONFIG[segment.moment_type] : null;

  return (
    <div className="rounded-lg border bg-card">
      {/* Collapsed header */}
      <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setExpanded(!expanded)}>
        <span className="text-xs font-mono text-muted-foreground w-8">{String(segment.sequence_number).padStart(3, '0')}</span>
        {momentCfg && <Badge className={`text-[10px] ${momentCfg.color}`}>{momentCfg.label}</Badge>}
        <p className="flex-1 text-sm line-clamp-2">{segment.narration}</p>
        <div className="flex items-center gap-1.5">
          <StatusDot status={segment.image_status} />
          <StatusDot status={segment.audio_status} />
        </div>
        <ChevronDown className={cn('h-4 w-4 transition-transform text-muted-foreground', expanded && 'rotate-180')} />
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="border-t px-3 pb-3 pt-3 space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Narração</label>
            <Textarea value={segment.narration} onChange={e => onUpdate({ narration: e.target.value })} rows={3} className="text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Prompt da imagem</label>
            <Textarea value={segment.image_prompt || ''} onChange={e => onUpdate({ image_prompt: e.target.value })} rows={2} className="text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Simbolismo</label>
            <Input value={segment.symbolism || ''} onChange={e => onUpdate({ symbolism: e.target.value })} className="text-sm" />
          </div>

          {showMedia && (
            <div className="space-y-3 pt-2">
              {segment.image_url && (
                <img src={segment.image_url} alt={`Segment ${segment.sequence_number}`} className="rounded-md max-h-40 object-contain" />
              )}
              {segment.audio_url && (
                <audio controls src={segment.audio_url} className="w-full h-8" />
              )}
              <div className="flex gap-2">
                {onGenerateImage && (
                  <Button variant="outline" size="sm" onClick={onGenerateImage} disabled={generatingImage}>
                    {generatingImage ? <Loader2 className="animate-spin h-3 w-3" /> : <Image className="h-3 w-3" />}
                    Gerar Imagem
                  </Button>
                )}
                {onGenerateAudio && (
                  <Button variant="outline" size="sm" onClick={onGenerateAudio} disabled={generatingAudio}>
                    {generatingAudio ? <Loader2 className="animate-spin h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                    Gerar Áudio
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
