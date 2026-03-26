

# Corrigir Segmentação: ~30 blocos e ~90 sub-cenas (7s por sub-cena)

## Problema

O "Re-segmentar (rápido)" divide por parágrafos individuais, gerando 75 blocos minúsculos. A lógica de sub-cenas em `split-sub-scenes.ts` usa thresholds que não consideram a meta de 7 segundos por sub-cena.

## Cálculo de referência

- Velocidade de fala: ~2.5 palavras/segundo
- 7 segundos = ~18 palavras por sub-cena
- Roteiro de ~2500 palavras → ~30 blocos de ~83 palavras → ~3 sub-cenas por bloco → ~90 sub-cenas

## Mudanças

### 1. `src/components/pipeline/SegmentsStep.tsx` — Segmentação local inteligente

Substituir o split por `\n\n` por lógica que **agrupa parágrafos consecutivos** até atingir ~80-100 palavras por bloco. Resultado: ~30 blocos em vez de 75.

### 2. `src/lib/split-sub-scenes.ts` — Thresholds para 7 segundos

Recalcular os thresholds baseado na meta de ~18 palavras por sub-cena:

| Palavras no bloco | Sub-cenas | Palavras/sub-cena | Duração estimada |
|---|---|---|---|
| < 30 | 1 | ~25 | ~10s |
| 30-54 | 2 | ~21 | ~8s |
| 55-79 | 3 | ~22 | ~9s |
| 80-109 | 4 | ~24 | ~9s |
| 110+ | 5 | ~24 | ~9s |

Manter regra de 1 sub-cena forçada para `cta` e `hook`.

### 3. `supabase/functions/adapt-script/index.ts` — Blocos maiores

Ajustar o prompt: blocos de **60-120 palavras** (em vez de 30-90) para gerar ~25-35 blocos com descrições visuais, alinhado com a segmentação local.

### Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/components/pipeline/SegmentsStep.tsx` | Agrupar parágrafos em blocos de ~80-100 palavras |
| `src/lib/split-sub-scenes.ts` | Novos thresholds para ~18 palavras/sub-cena (7s) |
| `supabase/functions/adapt-script/index.ts` | Prompt com blocos de 60-120 palavras |

