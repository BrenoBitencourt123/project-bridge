

# Suporte a roteiro pré-estruturado com marcadores de CENA

## Resumo
Quando o usuário colar um roteiro com marcadores tipo `CENA 01 — HOOK`, o sistema reconhece automaticamente as divisões de cena e só precisa criar as sub-cenas dentro de cada cena.

## Como funciona hoje
O `handleSegment` em `SegmentsStep.tsx` ignora qualquer estrutura do texto — agrupa parágrafos consecutivos até ~90 palavras. Isso re-segmenta um roteiro já organizado em cenas.

## Mudanças

### 1. `src/components/pipeline/SegmentsStep.tsx` — Detecção de cenas no roteiro

Na função `handleSegment`, antes do agrupamento por palavras:
- Verificar se o texto contém marcadores de cena (regex: `/^CENA\s+\d+/im`)
- **Se contém marcadores**: dividir o texto pelos marcadores, cada bloco vira um segmento com o título extraído do marcador
- **Se não contém marcadores**: manter o comportamento atual (agrupamento por ~90 palavras)
- Em ambos os casos, as sub-cenas continuam sendo criadas pela mesma lógica `splitIntoSubScenes`

A regex reconhecerá variações como:
- `CENA 01 — HOOK`
- `CENA 1 - O CONCEITO`
- `CENA 03:`

### 2. Nenhuma outra mudança necessária
- A geração de sub-cenas, áudio e prompts continua funcionando igual
- O `ScriptStep` não precisa mudar — o textarea já aceita texto livre

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/components/pipeline/SegmentsStep.tsx` | Adicionar detecção de marcadores CENA no `handleSegment` para preservar a estrutura do roteiro |

