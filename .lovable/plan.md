

# Reestruturação completa do pipeline de segmentação: macroblocos narrativos + subcenas semânticas

## Problema central

A arquitetura atual tem a inteligência na camada errada:

```text
HOJE:  roteiro → chunking mecânico (regex/tamanho) → IA subdivide cada chunk
IDEAL: roteiro → IA detecta macroblocos narrativos → IA subdivide cada macrobloco
```

Isso causa dois extremos: 25 subcenas (pouco) ou 77 subcenas (explosão pelo `Math.max(2)`).

## Nova arquitetura

```text
roteiro → [adapt-script v2] → 8-12 cenas por função narrativa
       → [split-sub-scenes v2] → ~42 subcenas semânticas (alvo global)
```

Uma única chamada de IA faz tudo: detecta macroblocos E subdivide em subcenas. Isso elimina o erro de cascata.

## Mudanças

### 1. `supabase/functions/adapt-script/index.ts` — Prompt de macroblocos narrativos

Reescrever o `SYSTEM_PROMPT` para que a IA:
- Identifique **funções narrativas** (hook, promessa, erro comum, intuição, conceito, fórmula, exemplo, variação, pegadinha, comparação, checklist, CTA) em vez de dividir por tamanho
- Gere **8-14 cenas** (não 20-35 blocos de tamanho fixo)
- Cada cena recebe um `scene_function` (label descritivo da função narrativa)
- Mantém o formato `{ video_script: [...] }` mas adiciona campo `scene_function`
- Roteiros com marcadores `CENA XX` continuam sendo processados localmente (sem chamada à IA)

### 2. `supabase/functions/split-sub-scenes/index.ts` — Alvo global + remoção do min(2)

- Remover `Math.max(2, ...)` → usar `Math.max(1, ...)`
- Receber novo parâmetro `scene_function` para que a IA saiba o papel narrativo da cena
- Ajustar pesos por função narrativa no prompt:
  - hook: 3-4 subcenas, promessa: 1-2, erro comum: 2-4, conceito: 4-6, exemplo: 4-6, pegadinha: 4-6, checklist: 2-3, CTA: 1-2
- Adicionar **merge pós-IA**: fundir subcenas com menos de 8 palavras à anterior
- Adicionar **cap global**: se total de subcenas de todas as cenas ultrapassar `target + 4`, logar warning

### 3. `src/components/pipeline/SegmentsStep.tsx` — Passar scene_function

- `handleAdapt`: extrair `scene_function` do retorno do adapt-script e passar para `splitWithAI`
- `handleSegment` (com marcadores CENA): inferir `scene_function` a partir do label (ex: "CENA 01 — HOOK" → "hook")
- `splitWithAI`: aceitar parâmetro `sceneFunction` e enviá-lo à edge function
- Estatísticas: já existentes, sem mudança

### 4. Formato de saída do `adapt-script`

```json
{
  "video_script": [
    {
      "time": "00:00 - 00:25",
      "narration": "texto...",
      "visual": "descrição visual...",
      "scene_function": "hook"
    }
  ]
}
```

## Resultado esperado

- Roteiro de ~1000 palavras → 8-14 cenas por função narrativa → ~40-44 subcenas
- Cenas curtas (CTA, promessa) → 1-2 subcenas naturalmente
- Cenas densas (conceito, exemplo, pegadinha) → 4-6 subcenas
- Sem explosão artificial pelo `Math.max(2)`

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `supabase/functions/adapt-script/index.ts` | Novo prompt: macroblocos narrativos (8-14 cenas) + campo `scene_function` |
| `supabase/functions/split-sub-scenes/index.ts` | Remover min(2), receber `scene_function`, pesos por função, merge pós-IA |
| `src/components/pipeline/SegmentsStep.tsx` | Passar `scene_function` para split-sub-scenes, extrair do adapt-script |

