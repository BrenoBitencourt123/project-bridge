

# Adicionar Modal de Detalhes ao Clicar na Sub-cena

## Problema
Atualmente, na grade de sub-cenas do MediaStep, não é possível ver o prompt da imagem nem editá-lo sem expandir o SegmentCard da etapa de Segmentos. O usuário quer clicar em qualquer card de sub-cena e ver/editar o prompt em um modal.

## Solução
Adicionar um **Dialog/Modal** que abre ao clicar no card da sub-cena na grade do `MediaStep.tsx`. O modal mostra:

- **Imagem gerada** (se existir)
- **Prompt da imagem** (editável via Textarea)
- **Narração** da sub-cena (somente leitura)
- **Simbolismo** do bloco pai (somente leitura)
- Botão para **Gerar/Refazer** imagem direto do modal

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/components/pipeline/MediaStep.tsx` | Adicionar estado para sub-cena selecionada + Dialog com detalhes e edição de prompt. Ao clicar no card da sub-cena, abre o modal em vez de nada. |

## Detalhes técnicos
- Usar o componente `Dialog` já existente em `src/components/ui/dialog.tsx`
- Estado: `selectedSubScene: { segment: Segment, subScene: SubScene } | null`
- Ao salvar edição do prompt no modal, atualizar via `updateSubSceneInSegments` (já existe)
- Botão "Gerar Imagem" no modal chama `handleGenerateSingleImage` existente

