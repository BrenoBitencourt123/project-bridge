import { DollarSign } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface CostLine {
  label: string;
  api: string;
  cost: number;
  badge: 'sua-chave' | 'incluso';
}

interface CostEstimateCardProps {
  /** Total words in script */
  wordCount?: number;
  /** Total chars of narration across all sub-scenes */
  charCount?: number;
  /** Number of sub-scenes (images) */
  subSceneCount?: number;
  /** Duration in minutes (for Whisper) */
  audioDurationMin?: number;
  /** Which steps have been performed */
  completedSteps?: {
    script?: boolean;
    segment?: boolean;
    prompts?: boolean;
    images?: boolean;
    audio?: boolean;
    transcription?: boolean;
  };
}

// Pricing constants
const GEMINI_INPUT_PER_1M = 0.15;
const GEMINI_OUTPUT_PER_1M = 0.60;
const ELEVENLABS_PER_1K_CHARS = 0.30;
const WHISPER_PER_MIN = 0.006;
const AVG_TOKENS_PER_WORD = 1.3;

function estimateGeminiCost(wordCount: number, outputMultiplier = 1): number {
  const inputTokens = wordCount * AVG_TOKENS_PER_WORD;
  const outputTokens = wordCount * AVG_TOKENS_PER_WORD * outputMultiplier;
  return (inputTokens / 1_000_000) * GEMINI_INPUT_PER_1M + (outputTokens / 1_000_000) * GEMINI_OUTPUT_PER_1M;
}

export function CostEstimateCard({
  wordCount = 0,
  charCount = 0,
  subSceneCount = 0,
  audioDurationMin = 0,
  completedSteps = {},
}: CostEstimateCardProps) {
  const lines: CostLine[] = [];

  // Script generation (Gemini)
  const scriptCost = estimateGeminiCost(wordCount, 2);
  lines.push({ label: 'Gerar Roteiro', api: 'Gemini', cost: scriptCost, badge: 'sua-chave' });

  // Segmentation (Gemini)
  const segmentCost = estimateGeminiCost(wordCount, 0.5);
  lines.push({ label: 'Segmentar', api: 'Gemini', cost: segmentCost, badge: 'sua-chave' });

  // Prompt generation (Gemini)
  const promptCost = estimateGeminiCost(wordCount, 0.3);
  lines.push({ label: 'Gerar Prompts', api: 'Gemini', cost: promptCost, badge: 'sua-chave' });

  // Images (Lovable AI)
  lines.push({ label: `Imagens (${subSceneCount})`, api: 'Lovable AI', cost: 0, badge: 'incluso' });

  // Audio (ElevenLabs)
  const audioCost = (charCount / 1000) * ELEVENLABS_PER_1K_CHARS;
  lines.push({ label: 'Narração', api: 'ElevenLabs', cost: audioCost, badge: 'sua-chave' });

  // Transcription (Whisper) – only if used
  if (audioDurationMin > 0) {
    const whisperCost = audioDurationMin * WHISPER_PER_MIN;
    lines.push({ label: 'Transcrição', api: 'Whisper', cost: whisperCost, badge: 'sua-chave' });
  }

  const total = lines.reduce((sum, l) => sum + l.cost, 0);

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <DollarSign className="h-4 w-4 text-muted-foreground" />
        <span>Custo Estimado</span>
        <span className="ml-auto font-semibold text-foreground">
          ${total < 0.01 ? '< 0.01' : total.toFixed(2)}
        </span>
      </div>

      <div className="space-y-1">
        {lines.map((line) => (
          <div key={line.label} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{line.label}</span>
              <Badge
                variant={line.badge === 'incluso' ? 'secondary' : 'outline'}
                className="text-[10px] px-1.5 py-0"
              >
                {line.badge === 'incluso' ? 'incluso' : line.api}
              </Badge>
            </div>
            <span className={line.cost === 0 ? 'text-muted-foreground' : 'text-foreground'}>
              {line.cost === 0 ? '$0.00' : line.cost < 0.01 ? '< $0.01' : `$${line.cost.toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
