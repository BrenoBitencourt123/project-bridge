

# Adaptar com IA: pular chamada à IA quando roteiro já tem CENA

## Problema
Quando o roteiro já vem com marcadores `CENA 01`, `CENA 02`, etc., o botão "Adaptar com IA" ainda chama a edge function `adapt-script` para re-segmentar — desnecessário, já que as cenas já estão definidas. O sistema só precisa criar as sub-cenas dentro de cada cena.

## Solução
No `handleAdapt` de `SegmentsStep.tsx`, detectar marcadores de CENA. Se existirem, **pular a chamada à edge function** e usar a mesma lógica local do `handleSegment` (dividir pelos marcadores + `splitIntoSubScenes`). Se não existirem, manter o fluxo atual com a IA.

## Mudança

### `src/components/pipeline/SegmentsStep.tsx`
No início do `handleAdapt`:
1. Verificar se `project.raw_script` contém marcadores `CENA \d+`
2. **Se sim**: reutilizar a lógica de parsing local (split pelos marcadores, remover linha do marcador, criar segmentos e sub-cenas) — idêntico ao que `handleSegment` já faz no branch `hasSceneMarkers`
3. **Se não**: manter o fluxo atual (chamar `adapt-script` e processar resposta da IA)

Na prática, extrair a lógica de "parse marcadores → criar segmentos → sub-cenas" para uma função compartilhada que tanto `handleSegment` quanto `handleAdapt` usam quando detectam marcadores.

## Resultado
- Roteiro com `CENA XX`: ambos botões funcionam localmente, sem chamar IA
- Roteiro sem marcadores: "Segmentar por parágrafos" = local, "Adaptar com IA" = chama edge function

| Arquivo | Mudança |
|---|---|
| `src/components/pipeline/SegmentsStep.tsx` | Adicionar detecção de CENA no `handleAdapt` para pular a chamada à IA e usar parsing local |

