

# Plano de Otimizacao: Segmentacao, Assets e UI do MediaStep

## Problemas identificados

1. **Assets nao influenciam as imagens**: Os assets sao selecionados no MediaStep, mas a selecao comeca vazia a cada render. Alem disso, o bloco CTA do roteiro ("curtir e se inscrever") gera 3-4 sub-cenas com imagens desnecessarias de "like/subscribe".

2. **Segmentacao gera sub-cenas demais**: O `split-sub-scenes.ts` divide puramente por contagem de palavras sem considerar o `momentType`. Blocos CTA com 100+ palavras geram 4 sub-cenas (4 imagens), quando 1 bastaria.

3. **UI do MediaStep confusa**: Muitos botoes no topo, cards expandiveis com campos repetidos (prompt do bloco + prompt de cada sub-cena), informacao visual poluida.

4. **segment-script usa GOOGLE_AI_API_KEY diretamente**: Nao usa o Lovable AI Gateway. A referencia Atlas-new-creators usa `LOVABLE_API_KEY` via gateway para tudo exceto TTS.

## Plano de implementacao

### 1. Migrar `segment-script` para Lovable AI Gateway
- Trocar a chamada `generativelanguage.googleapis.com` por `ai.gateway.lovable.dev/v1/chat/completions`
- Usar `LOVABLE_API_KEY` em vez de `GOOGLE_AI_API_KEY`
- Manter o prompt e a logica de parsing JSON
- Resultado: elimina custo do Gemini na sua chave para segmentacao

### 2. Ajustar prompt de segmentacao para blocos inteligentes
- Adicionar regra no prompt: **blocos de CTA devem ser um unico bloco curto** (nao fragmentar em multiplas sub-cenas)
- Adicionar regra: **imagePrompt de blocos CTA deve ser generico** ("tela com botoes de curtir e se inscrever" - 1 imagem so)
- Adicionar campo `maxSubScenes` na resposta do Gemini para que o segmentador sugira quantas sub-cenas cada bloco precisa

### 3. Tornar `split-sub-scenes` ciente do momentType
- Receber `momentType` como parametro
- Blocos `cta` e `hook`: forcam **maximo 1 sub-cena** (nao precisa de multiplas imagens)
- Blocos `concept`, `example`, `list_summary`: manter logica atual (1-4 sub-cenas por tamanho)
- Isso resolve diretamente o problema de 3 imagens de "curtir e se inscrever"

### 4. Simplificar a UI do MediaStep
- **HUD compacto**: Unir os botoes em um dropdown menu ("Acoes") em vez de 4 botoes inline
- **SegmentCard simplificado**: No modo media, mostrar apenas as sub-cenas com imagem + player de audio, escondendo o prompt base do bloco (que ja foi processado)
- **Grid de imagens**: Mostrar as imagens das sub-cenas em grid (2-3 colunas) em vez de lista vertical, facilitando visualizacao rapida do video
- **Barra de progresso unificada**: Uma unica barra com cores (azul = imagens, verde = audios) em vez de duas separadas

### 5. Atualizar CostEstimateCard
- Remover linhas de custo Gemini (Script, Segmentar, Prompts) ja que serao todos via Lovable AI Gateway (custo zero)
- Manter apenas: ElevenLabs (audio) e Whisper (transcricao) como custos do usuario

## Arquivos alterados

| Arquivo | Mudanca |
|---|---|
| `supabase/functions/segment-script/index.ts` | Migrar para Lovable AI Gateway + ajustar prompt |
| `src/lib/split-sub-scenes.ts` | Receber momentType, limitar sub-cenas por tipo |
| `src/components/pipeline/SegmentsStep.tsx` | Passar momentType para splitIntoSubScenes |
| `src/components/pipeline/MediaStep.tsx` | Redesign da UI: dropdown de acoes, grid de imagens |
| `src/components/pipeline/SegmentCard.tsx` | Simplificar visual no modo media |
| `src/components/pipeline/CostEstimateCard.tsx` | Remover custos Gemini, atualizar layout |

## Resultado esperado
- Video de 8 min: ~20-30 imagens (em vez de 60+)
- Blocos CTA/Hook geram apenas 1 imagem
- UI mais limpa e facil de navegar
- Custo zero de Gemini (tudo via Lovable AI)
- Assets selecionados continuam sendo injetados no prompt de cada imagem

