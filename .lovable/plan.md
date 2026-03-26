

# Simplificar geração de imagens: 1 imagem por sub-cena

## Problema
O modo de painéis empilhados (2-3 sub-cenas numa única imagem + recorte via Canvas) prejudica a qualidade das imagens individuais.

## Solução
Remover toda a lógica de painéis e sempre gerar 1 imagem por sub-cena individualmente.

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/components/pipeline/MediaStep.tsx` | Remover função `cropPanelsFromImage`, remover `uploadCroppedPanel`, simplificar `handleGenerateAllImages` para sempre chamar `generateSingleSubSceneImage` para cada sub-cena pendente (sem branch de panel mode) |
| `supabase/functions/generate-image/index.ts` | Remover parâmetros `panelCount`/`panelPrompts`, remover branch de panel mode no prompt, remover sufixo `-panels` no filename. Manter apenas o modo single 16:9 |

## Detalhes técnicos
- No `MediaStep.tsx`, o loop em `handleGenerateAllImages` passa a ser simples: para cada segmento, itera todas sub-cenas pendentes chamando `generateSingleSubSceneImage` com anti-repetição acumulada
- Na edge function, remove-se o bloco `isPanelMode` do prompt e a resposta sempre retorna `isPanelImage: false`
- ~20 linhas removidas no frontend, ~15 na edge function

