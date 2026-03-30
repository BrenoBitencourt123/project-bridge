

# Adaptar com IA respeitando marcadores de CENA

## Problema
O `adapt-script` recebe o roteiro inteiro e re-segmenta em blocos de 60-120 palavras, ignorando os marcadores `CENA XX`. O usuário quer que a IA preserve as cenas e apenas crie sub-cenas dentro de cada uma.

## Solução
Atualizar o prompt do `adapt-script` para reconhecer marcadores de CENA e preservá-los como divisões primárias. Cada CENA vira um segmento; a IA só divide internamente se necessário.

## Mudanças

### 1. `supabase/functions/adapt-script/index.ts` — Prompt atualizado
- Detectar no texto se há marcadores `CENA \d+` antes de enviar à IA
- Se há marcadores: usar um prompt alternativo que instrui a IA a:
  - Manter cada CENA como um bloco separado (não mesclar cenas)
  - Preservar a narração de cada cena quase intacta
  - Gerar o campo `visual` para cada cena
  - Não re-segmentar o conteúdo entre cenas
- Se não há marcadores: manter o prompt atual (blocos de 60-120 palavras)

### 2. `src/components/pipeline/SegmentsStep.tsx` — handleAdapt usa splitIntoSubScenes
- Nenhuma mudança necessária aqui — o `handleAdapt` já cria sub-cenas via `splitIntoSubScenes` após receber os blocos da IA. Se a IA retorna 7 blocos (1 por cena), o frontend cria as sub-cenas dentro de cada um automaticamente.

## Fluxo resultante
```text
Roteiro com CENA → adapt-script (7 blocos, 1 por cena) → frontend splitIntoSubScenes → sub-cenas por cena
Roteiro sem CENA  → adapt-script (20-35 blocos de ~90 palavras) → frontend splitIntoSubScenes → sub-cenas por bloco
```

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `supabase/functions/adapt-script/index.ts` | Adicionar detecção de marcadores CENA e prompt alternativo que preserva a estrutura de cenas |

