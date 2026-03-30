

# Reformular prompt da edge function `split-sub-scenes` para densidade visual alta (~42 subcenas)

## Problema
O prompt atual da edge function `split-sub-scenes` gera sub-cenas conservadoras (15-35 palavras, ~25 subcenas para 6min). O GPT com seu prompt detalhado gera ~42 subcenas porque usa critérios mais granulares: separa contrastes, passos de cálculo, erro vs correção, pergunta vs resposta, etc.

## Solução
Reescrever o `SYSTEM_PROMPT` da edge function com toda a lógica detalhada que você definiu, incluindo:
- Os 7 gatilhos de corte (foco, visual, exemplo, contraste, cálculo, erro/correção, comparação)
- Meta de densidade: `targetSubscenes = round(estimatedDurationSec / 8.5)` → 42 para 6min
- Faixa de palavras por subcena: 12-32 (max 38)
- Exemplos concretos de pensamento correto
- Heurística de second pass: se `subsceneCount < target * 0.9`, reprocessar com maior granularidade

Além disso, passar o `wordCount` total do roteiro na chamada para que a IA saiba a meta de densidade.

## Mudanças

### 1. `supabase/functions/split-sub-scenes/index.ts`
- Reescrever o `SYSTEM_PROMPT` com todos os critérios detalhados do seu prompt
- Aceitar novo parâmetro `total_word_count` no body para calcular `targetSubscenes`
- Incluir no user message: a meta de subcenas para esta cena (proporcional ao total)
- Aumentar `max_tokens` para 16384 (mais subcenas = mais output)
- Adicionar validação pós-IA: se subcenas geradas < esperado, incluir instrução de "maior granularidade" no prompt

### 2. `src/components/pipeline/SegmentsStep.tsx`
- Passar `total_word_count` do roteiro completo na chamada `splitWithAI`
- Passar `total_scenes` para que a IA distribua a meta proporcional
- Atualizar a exibição de stats: mostrar também média de segundos/subcena

## Resultado esperado
- Roteiro de ~1000 palavras (6min) → ~42 subcenas em vez de ~25
- Cada subcena = 1 ideia + 1 imagem + ~8.5s de áudio
- Cortes semânticos por contraste, cálculo, erro/correção, etc.

| Arquivo | Mudança |
|---|---|
| `supabase/functions/split-sub-scenes/index.ts` | Reescrever prompt com critérios detalhados + meta de densidade + validação |
| `src/components/pipeline/SegmentsStep.tsx` | Passar word count total e scene count para a edge function |

