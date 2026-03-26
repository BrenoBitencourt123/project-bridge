

# Corrigir cortes de áudio importado com sub-cenas < 1 segundo

## Problema
Quando o áudio é **importado** (não gerado pelo ElevenLabs), o sistema usa Whisper para transcrever e obter timestamps. O texto transcrito pelo Whisper pode diferir significativamente do roteiro original (palavras diferentes, pontuação, formatação), causando falhas no `findCutTimeForText` que usa `indexOf` para casar o texto da narração com o texto do alinhamento. Quando falha, o fallback retorna tempos imprecisos, gerando cortes de < 1 segundo.

## Solução em `src/lib/find-cut-points.ts`

### 1. Normalização robusta
Criar função `normalize(text)` que remove pontuação, acentos, e normaliza espaços antes de qualquer comparação.

### 2. Busca progressiva com posição mínima
- Buscar 5 palavras → 3 → 2 → 1 palavra, sempre a partir da posição do corte anterior (evitar matches duplicados)
- Usar a versão normalizada para comparação

### 3. Duração mínima entre cortes (3.5s)
Após calcular todos os cut points no `findSubSceneCutPoints`, ajustar qualquer par de cortes consecutivos que tenha menos de 3.5 segundos de diferença, redistribuindo proporcionalmente o tempo total do áudio entre as sub-cenas.

### 4. Fallback proporcional melhorado
Quando nenhum matching textual funcionar, distribuir os cortes proporcionalmente ao número de palavras de cada sub-cena em relação ao total, em vez do fallback atual (`lastTime * 0.5`).

## Arquivo alterado
- `src/lib/find-cut-points.ts`

