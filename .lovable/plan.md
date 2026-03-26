

# Reduzir quantidade de imagens alinhando com referência Atlas-new-creators

## Problema atual
O sistema gera imagens demais para um vídeo de 6-8 minutos. Isso acontece em duas camadas:

1. **Segmentação (segment-script)**: O prompt pede "40 a 60 blocos para um roteiro de 10 minutos" com 30-90 palavras cada
2. **Sub-cenas (split-sub-scenes.ts)**: Cada bloco é subdividido em sub-cenas de 10-20 palavras (TARGET=15), gerando 2-5 sub-cenas por bloco

Resultado: 40 blocos x ~3 sub-cenas = ~120 imagens. Para 6-8 min, isso é excessivo.

## Como a referência (Atlas-new-creators) faz

A função `splitNarrationIntoSubScenes` da referência usa regras muito mais conservadoras:
- < 25 palavras → 1 sub-cena
- < 50 palavras → 2 sub-cenas
- < 75 palavras → 3 sub-cenas
- >= 75 palavras → 4 sub-cenas (MAX)
- Nunca mais que 4 sub-cenas por segmento

## Plano de alteração

### 1. Ajustar `src/lib/split-sub-scenes.ts`
Adotar a lógica da referência:
- Substituir a lógica atual (TARGET_WORDS/MIN_WORDS/MAX_WORDS) pela lógica de faixas de palavras
- Cap de MAX 4 sub-cenas por segmento
- Manter a distribuição por sentenças e os PERSPECTIVE_HINTS

### 2. Ajustar prompt do `supabase/functions/segment-script/index.ts`
- Reduzir de "40 a 60 blocos" para "8 a 15 blocos para um roteiro de ~8 minutos"
- Aumentar faixa de palavras por bloco de "30-90" para "60-150" (blocos maiores = menos blocos)
- Isso resulta em ~12 blocos x ~2-3 sub-cenas = ~30-40 imagens total

### 3. Ajustar `MIN_GAP_SECONDS` em `find-cut-points.ts`
- Manter em 7 segundos, que agora fará mais sentido com menos sub-cenas

## Resultado esperado
- Vídeo de 6-8 min: ~30-40 imagens (em vez de 100+)
- Cada imagem fica visível por 7-15 segundos
- Alinhado com a abordagem da referência

## Arquivos alterados
- `src/lib/split-sub-scenes.ts` — lógica de subdivisão
- `supabase/functions/segment-script/index.ts` — prompt de segmentação

