import { useState } from 'react';
import { Download, Image, Volume2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segment } from '@/types/atlas';
import JSZip from 'jszip';

interface ExportStepProps {
  projectTitle: string;
  segments: Segment[];
}

export function ExportStep({ projectTitle, segments }: ExportStepProps) {
  const [downloading, setDownloading] = useState(false);

  const allSubScenes = segments.flatMap(s =>
    (s.sub_scenes || [])
  );
  const imagesReady = allSubScenes.filter(sc => sc.image_status === 'done').length;
  const audiosReady = allSubScenes.filter(sc => sc.audio_status === 'done').length;
  const totalFiles = imagesReady + audiosReady;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const zip = new JSZip();
      for (const seg of segments) {
        const num = String(seg.sequence_number).padStart(3, '0');

        for (const sc of (seg.sub_scenes || [])) {
          // Image
          if (sc.image_url && sc.image_status === 'done') {
            const res = await fetch(sc.image_url);
            const blob = await res.blob();
            zip.file(`segment-${num}-sub-${sc.sub_index}.png`, blob);
          }
          // Audio
          if (sc.audio_url && sc.audio_status === 'done') {
            const res = await fetch(sc.audio_url);
            const blob = await res.blob();
            zip.file(`segment-${num}-sub-${sc.sub_index}.wav`, blob);
          }
        }
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectTitle.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <p className="text-muted-foreground">
          {imagesReady} imagens · {audiosReady} áudios
        </p>
      </div>

      <div className="space-y-1 max-h-96 overflow-y-auto">
        {segments.map(seg => {
          const num = String(seg.sequence_number).padStart(3, '0');
          const subScenes = seg.sub_scenes || [];
          return (
            <div key={seg.id} className="space-y-0.5">
              <div className="flex items-center gap-3 rounded px-3 py-1.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{num}</span>
                <span className="text-xs text-muted-foreground">{subScenes.length} sub-cenas</span>
                <span className="flex-1 truncate">{seg.narration.slice(0, 60)}</span>
              </div>
              {subScenes.map(sc => (
                <div key={sc.id} className="flex items-center gap-3 rounded px-6 py-0.5 text-xs text-muted-foreground">
                  <span className="font-mono">sub-{sc.sub_index}</span>
                  <Image className={`h-3 w-3 ${sc.image_status === 'done' ? 'text-success' : 'text-muted-foreground/40'}`} />
                  <Volume2 className={`h-3 w-3 ${sc.audio_status === 'done' ? 'text-success' : 'text-muted-foreground/40'}`} />
                  <span className="truncate">{sc.narration_segment.slice(0, 50)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <Button className="w-full" size="lg" onClick={handleDownload} disabled={downloading || totalFiles === 0}>
        {downloading ? <Loader2 className="animate-spin" /> : <Download className="h-4 w-4" />}
        Baixar ZIP ({totalFiles} arquivos)
      </Button>
    </div>
  );
}
