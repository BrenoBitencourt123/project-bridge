

# Áudio por Sub-cena (1 áudio = 1 imagem)

## Objetivo

Mudar o fluxo de áudio de "1 por bloco/segmento" para "1 por sub-cena". O áudio completo é gerado a partir do roteiro inteiro (garantindo consistência de voz), depois fatiado nos pontos de corte de cada sub-cena. Resultado: cada sub-cena tem 1 imagem + 1 áudio — basta arrastar tudo na timeline do editor.

## Mudanças no Banco de Dados

Adicionar `audio_url` e `audio_status` à tabela `sub_scenes`:

```sql
ALTER TABLE public.sub_scenes
  ADD COLUMN audio_url TEXT,
  ADD COLUMN audio_status public.media_status NOT NULL DEFAULT 'idle';
```

## Mudanças nos Tipos

`SubScene` ganha `audio_url` e `audio_status`.

## Lógica de Corte (find-cut-points)

Atualmente corta por segmento. Será alterado para cortar por sub-cena:
- Flatten todas as sub-cenas de todos os segmentos em ordem
- Buscar o texto de cada sub-cena no alinhamento para encontrar o cut time
- Retornar `(totalSubScenes - 1)` cut points

## MediaStep — Gerar Todos Áudios

Fluxo atualizado:

```text
1. generate-audio-batch (roteiro completo) → áudio + alignment
2. Flatten sub-cenas em ordem: seg1-sub1, seg1-sub2, seg2-sub1...
3. findSubSceneCutPoints(rawScript, alignment, allSubScenes)
4. splitAudio nos cut points → 1 blob por sub-cena
5. Upload cada blob → sub_scenes.audio_url
6. Atualizar sub_scenes.audio_status = 'done'
```

Mesmo fluxo para "Enviar Áudio" (importação manual).

## MediaStep — Progress e Status

- Progress de áudio conta sub-cenas (não segmentos)
- `allDone` verifica imagens E áudios por sub-cena
- O campo `segments.audio_status/audio_url` vira um resumo (all sub-scenes done → segment done) ou simplesmente não é mais usado

## SegmentCard

- Player de áudio aparece em cada sub-cena (não no nível do bloco)
- Status dots de áudio por sub-cena

## ExportStep

- ZIP exporta `segment-001-sub-1.wav`, `segment-001-sub-2.wav` etc.
- Cada arquivo de imagem já tem esse padrão

## Arquivos Alterados

1. **Migration SQL** — adicionar `audio_url`, `audio_status` em `sub_scenes`
2. **`src/types/atlas.ts`** — `SubScene` ganha campos de áudio
3. **`src/lib/find-cut-points.ts`** — nova função `findSubSceneCutPoints` que opera sobre sub-cenas
4. **`src/components/pipeline/MediaStep.tsx`** — fluxo de áudio fatia por sub-cena, progress por sub-cena
5. **`src/components/pipeline/SegmentCard.tsx`** — audio player por sub-cena
6. **`src/components/pipeline/ExportStep.tsx`** — export áudio por sub-cena
7. **`src/pages/ProjectPipeline.tsx`** — carregar `audio_url`/`audio_status` das sub-cenas

