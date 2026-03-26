import { useState } from 'react';
import { Download, Image, Volume2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segment } from '@/types/atlas';
import { CostEstimateCard } from './CostEstimateCard';
import JSZip from 'jszip';

interface ExportStepProps {
  projectTitle: string;
  segments: Segment[];
}

export function ExportStep({ projectTitle, segments }: ExportStepProps) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const allSubScenes = segments.flatMap(s =>
    (s.sub_scenes || [])
  );
  const imagesReady = allSubScenes.filter(sc => sc.image_status === 'done').length;
  const audiosReady = allSubScenes.filter(sc => sc.audio_status === 'done').length;
  const totalFiles = imagesReady + audiosReady;

  const handleDownload = async () => {
    setDownloading(true);
    setProgress({ done: 0, total: totalFiles });
    try {
      const zip = new JSZip();

      // Build list of all files to fetch
      const tasks: { url: string; name: string }[] = [];
      for (const seg of segments) {
        const num = String(seg.sequence_number).padStart(3, '0');
        for (const sc of (seg.sub_scenes || [])) {
          if (sc.image_url && sc.image_status === 'done') {
            tasks.push({ url: sc.image_url, name: `segment-${num}-sub-${sc.sub_index}.png` });
          }
          if (sc.audio_url && sc.audio_status === 'done') {
            tasks.push({ url: sc.audio_url, name: `segment-${num}-sub-${sc.sub_index}.wav` });
          }
        }
      }

      // Parallel fetch with concurrency limit
      let completed = 0;
      const CONCURRENCY = 6;
      const queue = [...tasks];

      const worker = async () => {
        while (queue.length > 0) {
          const task = queue.shift();
          if (!task) break;
          try {
            const res = await fetch(task.url);
            const blob = await res.blob();
            zip.file(task.name, blob);
          } catch (e) {
            console.warn(`Failed to fetch ${task.name}:`, e);
          }
          completed++;
          setProgress({ done: completed, total: tasks.length });
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

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

      <CostEstimateCard
        charCount={allSubScenes.reduce((sc_sum, sc) => sc_sum + (sc.narration_segment?.length || 0), 0)}
        subSceneCount={allSubScenes.length}
      />

      <Button className="w-full" size="lg" onClick={handleDownload} disabled={downloading || totalFiles === 0}>
        {downloading ? <Loader2 className="animate-spin" /> : <Download className="h-4 w-4" />}
        {downloading
          ? `Baixando... ${progress.done}/${progress.total}`
          : `Baixar ZIP (${totalFiles} arquivos)`}
      </Button>
    </div>
  );
}
