

## Fix: Filtrar segmentos inválidos antes do INSERT

No `SegmentsStep.tsx`, após montar o array `newSegments`, filtrar os que têm `narration` nulo/vazio antes do INSERT:

**Arquivo:** `src/components/pipeline/SegmentsStep.tsx`

1. Após o `.map()` que cria `newSegments` (linha ~38), adicionar filtro:
```ts
const validSegments = newSegments.filter(s => s.narration && s.narration.trim() !== "");
```

2. Usar `validSegments` no `.insert()` em vez de `newSegments`

3. Usar `inserted.length` (que já é usado) no toast — nenhuma outra alteração necessária.

