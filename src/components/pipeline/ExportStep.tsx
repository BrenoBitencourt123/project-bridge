import { useState } from 'react';
import { Download, Volume2, Loader2, Copy, Check, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Segment } from '@/types/atlas';
import JSZip from 'jszip';
import { buildImagePrompt } from '@/lib/buildImagePrompt';

interface ExportStepProps {
  projectTitle: string;
  segments: Segment[];
  geminiStyle: string;
  stylePromptPrefix?: string;
}

export function ExportStep({ projectTitle, segments, geminiStyle, stylePromptPrefix }: ExportStepProps) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const allSubScenes = segments.flatMap(s => s.sub_scenes || []);
  const audiosReady = allSubScenes.filter(sc => sc.audio_status === 'done').length;

  // Sub-cenas com prompt completo para Gemini
  const geminiSubScenes = segments.flatMap(seg =>
    (seg.sub_scenes || [])
      .sort((a, b) => a.sub_index - b.sub_index)
      .map(sc => {
        const total = seg.sub_scenes?.length ?? 1;
        const prompt = buildImagePrompt({
          imagePrompt: sc.image_prompt || seg.image_prompt || sc.narration_segment,
          narration: sc.narration_segment,
          styleName: geminiStyle === 'padrao' ? '' : geminiStyle,
          stylePrefix: stylePromptPrefix || undefined,
          subIndex: sc.sub_index,
          totalSubScenes: total,
        });
        const id = `${seg.id}-${sc.sub_index}`;
        return { id, segNum: seg.sequence_number, subIndex: sc.sub_index, narration: sc.narration_segment, prompt };
      })
  );

  const handleCopySingle = async (id: string, prompt: string) => {
    await navigator.clipboard.writeText(prompt);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAll = async () => {
    const all = geminiSubScenes
      .map((sc, i) => `=== IMAGEM ${i + 1} (${String(sc.segNum).padStart(2,'0')}.${sc.subIndex}) ===\n${sc.prompt}`)
      .join('\n\n');
    await navigator.clipboard.writeText(all);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleDownload = async () => {
    setDownloading(true);
    const tasks: { url: string; name: string }[] = [];
    for (const seg of segments) {
      const num = String(seg.sequence_number).padStart(3, '0');
      for (const sc of (seg.sub_scenes || [])) {
        if (sc.audio_url && sc.audio_status === 'done') {
          tasks.push({ url: sc.audio_url, name: `segment-${num}-sub-${sc.sub_index}.wav` });
        }
      }
    }
    setProgress({ done: 0, total: tasks.length });
    try {
      const zip = new JSZip();

      // Add prompts text file (prompts Gemini enriquecidos)
      const geminiPromptsText = geminiSubScenes
        .map((sc, i) => `=== IMAGEM ${i + 1} (${String(sc.segNum).padStart(2,'0')}.${sc.subIndex}) ===\n${sc.prompt}`)
        .join('\n\n');
      zip.file('prompts.txt', geminiPromptsText);

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
          {audiosReady} áudios · {allSubScenes.length} prompts de imagem
        </p>
      </div>

      {/* Audio list */}
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
                  <Volume2 className={`h-3 w-3 ${sc.audio_status === 'done' ? 'text-green-500' : 'text-muted-foreground/40'}`} />
                  <span className="truncate">{sc.narration_segment.slice(0, 50)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Prompts para Gemini */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            <h4 className="text-sm font-medium">Prompts para Gemini</h4>
            <span className="text-xs text-muted-foreground">({geminiSubScenes.length} imagens)</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCopyAll}>
              {copiedAll ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiedAll ? 'Copiado!' : 'Copiar todos'}
            </Button>
          </div>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {geminiSubScenes.map((sc, i) => (
            <div key={sc.id} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-muted-foreground">
                  Imagem {i + 1} · cena {String(sc.segNum).padStart(2,'0')}.{sc.subIndex}
                </span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => handleCopySingle(sc.id, sc.prompt)}>
                  {copiedId === sc.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedId === sc.id ? 'Copiado!' : 'Copiar'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground truncate">{sc.narration.slice(0, 80)}</p>
              <Textarea readOnly value={sc.prompt} className="text-xs font-mono leading-relaxed min-h-[80px] resize-none" />
            </div>
          ))}
        </div>
      </div>

      <Button className="w-full" size="lg" onClick={handleDownload} disabled={downloading || audiosReady === 0}>
        {downloading ? <Loader2 className="animate-spin" /> : <Download className="h-4 w-4" />}
        {downloading
          ? `Baixando... ${progress.done}/${progress.total}`
          : `Baixar ZIP (${audiosReady} áudios + prompts.txt)`}
      </Button>
    </div>
  );
}
