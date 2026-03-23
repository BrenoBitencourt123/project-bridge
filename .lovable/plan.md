

# Migração para Segmentação em 2 Níveis (Blocos + Sub-cenas)

## Visão Geral

Migrar a estrutura de segmentação de "linear" (1 segmento = 1 imagem = 1 áudio) para "2 níveis" (1 bloco = 1 áudio + 1-4 sub-cenas/imagens), inspirado no repositório Atlas-new-creators.

**Resultado:** Cada bloco de narração (30-90 palavras) gera UM áudio contínuo e 1-4 imagens que alternam durante aquele trecho, criando vídeos mais dinâmicos.

**UPDATE:** Migrado para 1 áudio por sub-cena. O áudio completo é gerado do roteiro inteiro e fatiado nos pontos de corte de cada sub-cena. Cada sub-cena tem 1 imagem + 1 áudio.

---

## Status de Implementação

1. ✅ Migration DB: tabela `sub_scenes` com RLS + colunas `audio_url`/`audio_status`
2. ✅ Tipos TypeScript: `SubScene` com campos de áudio
3. ✅ Atualizar `segment-script` (blocos maiores)
4. ✅ Função `splitIntoSubScenes` no frontend
5. ✅ Atualizar `SegmentsStep` para criar sub-cenas
6. ✅ Atualizar `SegmentCard` para mostrar sub-cenas com audio player individual
7. ✅ Atualizar `MediaStep` para gerar imagens por sub-cena + áudio fatiado por sub-cena
8. ✅ Atualizar `ExportStep` para ZIP com imagens E áudios por sub-cena
9. ✅ Carregar sub-cenas na query do `ProjectPipeline`
10. ✅ `findSubSceneCutPoints` em find-cut-points.ts

## Arquitetura Final

```text
Roteiro → segment-script (blocos de 30-90 palavras)
       → splitIntoSubScenes (1-4 sub-cenas por bloco)
       → INSERT segments + sub_scenes no DB

Mídia:
  Imagens → 1 por sub-cena
  Áudios  → áudio completo gerado do roteiro inteiro
          → fatiado por sub-cena usando alignment
          → 1 .wav por sub-cena

Export → ZIP com segment-001-sub-1.png + segment-001-sub-1.wav etc.
```
