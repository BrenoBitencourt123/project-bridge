

# Remover geração de imagens e adicionar exportação de prompts

## Resumo
Substituir toda a lógica de geração de imagens via API por uma textarea copiável que exibe todos os prompts organizados por cena/subcena.

## Mudanças

### 1. `src/components/pipeline/MediaStep.tsx` — Simplificar drasticamente
- Remover: `handleGenerateAllImages`, `generateSingleSubSceneImage`, toda lógica de geração de imagem (progress, style template, assets, etc.)
- Remover: modal de detalhes de sub-cena com edição de prompt e botão "Gerar Imagem"
- Remover: grid de thumbnails de imagens
- Manter: geração de áudio (batch + import) intacta
- Adicionar: **textarea read-only** com o texto estruturado de todos os prompts, formatado como:
  ```
  CENA 01: [narração resumida]
    SUBCENA 01.1: [prompt da imagem]
    SUBCENA 01.2: [prompt da imagem]
  ```
- Adicionar: botão "Copiar Prompts" que copia o conteúdo da textarea para o clipboard
- Manter botão "Regenerar Prompts" (chama a edge function existente) para o usuário poder refinar os prompts antes de copiar

### 2. `src/components/pipeline/ExportStep.tsx` — Ajustar
- Remover referências a imagens (contagem de imagens, download de imagens no ZIP)
- Manter download de áudios no ZIP
- Adicionar a mesma textarea de prompts estruturados para referência na etapa final

### 3. Limpeza
- Remover imports não utilizados (`StyleTemplateSelector`, `AssetReferenceSelector`, `CostEstimateCard` do MediaStep)
- A edge function `generate-image` e `regenerate-prompts` continuam existindo (regenerate-prompts ainda é útil para gerar/refinar os prompts textuais)

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/components/pipeline/MediaStep.tsx` | Remover geração de imagens, adicionar textarea com prompts estruturados + botão copiar |
| `src/components/pipeline/ExportStep.tsx` | Remover referências a imagens, adicionar textarea de prompts |

