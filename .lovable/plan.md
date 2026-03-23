

# Migração para Segmentação em 2 Níveis (Blocos + Sub-cenas)

## Visão Geral

Migrar a estrutura de segmentação de "linear" (1 segmento = 1 imagem = 1 áudio) para "2 níveis" (1 bloco = 1 áudio + 1-4 sub-cenas/imagens), inspirado no repositório Atlas-new-creators.

**Resultado:** Cada bloco de narração (30-90 palavras) gera UM áudio contínuo e 1-4 imagens que alternam durante aquele trecho, criando vídeos mais dinâmicos.

---

## Mudanças no Banco de Dados

**Nova tabela `sub_scenes`:**
- `id` UUID PK
- `segment_id` UUID FK → segments (cascade delete)
- `sub_index` INTEGER NOT NULL (1-4)
- `narration_segment` TEXT NOT NULL (trecho da narração do bloco)
- `image_prompt` TEXT
- `image_url` TEXT nullable
- `image_status` ENUM media_status default 'idle'
- `created_at`, `updated_at` TIMESTAMP
- UNIQUE(segment_id, sub_index)
- RLS: acesso via join segments → projects → user_id

**Alterações na tabela `segments`:**
- Campo `image_url` e `image_status` continuam existindo como "resumo" (status geral do bloco), mas as imagens individuais ficam em `sub_scenes`
- Aumentar range de narração esperado: 30-90 palavras por bloco (antes era 8-25)

---

## Mudanças nos Tipos TypeScript

**Novo tipo `SubScene`:**
```typescript
export interface SubScene {
  id: string;
  segment_id: string;
  sub_index: number;
  narration_segment: string;
  image_prompt: string | null;
  image_url: string | null;
  image_status: MediaStatus;
}
```

**Segment** ganha campo opcional `sub_scenes: SubScene[]` para uso no frontend.

---

## Mudanças na Edge Function `segment-script`

Atualizar o prompt para gerar blocos maiores (30-90 palavras, ~40-60 blocos para roteiro de 10 min em vez de 70-95 segmentos pequenos). Cada bloco continua com `narration`, `imagePrompt`, `symbolism`, `momentType`.

---

## Lógica de Sub-cenas (Frontend)

Nova função `splitIntoSubScenes(segment)` no frontend (como no repo de referência):

```text
wordCount < 25  → 1 sub-cena
25-49 palavras  → 2 sub-cenas
50-74 palavras  → 3 sub-cenas
75+ palavras    → 4 sub-cenas
```

Divide a narração do bloco em sentenças e distribui entre as sub-cenas. Cada sub-cena recebe um prompt de imagem com ângulo/perspectiva diferente.

---

## Mudanças nos Componentes

### SegmentsStep
- Após segmentar, criar sub-cenas automaticamente para cada bloco usando `splitIntoSubScenes`
- INSERT sub-cenas na nova tabela `sub_scenes`

### SegmentCard
- Expandido mostra as sub-cenas como cards internos (1-4 mini-cards com preview de imagem)
- Cada sub-cena tem seu próprio prompt editável e botão "Gerar Imagem"

### MediaStep
- "Gerar Todas Imagens" itera por sub-cenas (não por segmentos)
- Progress bar conta sub-cenas totais
- O áudio continua sendo 1 por bloco (sem mudança no fluxo de áudio)

### ExportStep
- ZIP exporta imagens nomeadas como `segment-001-sub-1.png`, `segment-001-sub-2.png`, etc.
- Áudios continuam `segment-001.wav`

---

## Fluxo Resumido

```text
Roteiro → segment-script (blocos de 30-90 palavras)
       → splitIntoSubScenes (1-4 sub-cenas por bloco)
       → INSERT segments + sub_scenes no DB

Mídia:
  Imagens → gerar 1 por sub-cena (total: ~120-200 imagens)
  Áudios  → 1 por bloco (total: ~40-60 áudios)
            OU batch completo + split (mesmo fluxo atual)

Export → ZIP com imagens por sub-cena + áudios por bloco
```

---

## Ordem de Implementação

1. Migration DB: criar tabela `sub_scenes` com RLS
2. Tipos TypeScript: adicionar `SubScene`
3. Atualizar `segment-script` (blocos maiores)
4. Função `splitIntoSubScenes` no frontend
5. Atualizar `SegmentsStep` para criar sub-cenas
6. Atualizar `SegmentCard` para mostrar sub-cenas
7. Atualizar `MediaStep` para gerar imagens por sub-cena
8. Atualizar `ExportStep` para ZIP com sub-cenas
9. Carregar sub-cenas na query do `ProjectPipeline`

