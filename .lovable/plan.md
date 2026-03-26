

# Corrigir Assets para Influenciar Imagens Geradas

## Problema raiz

Analisando os requests de rede, o campo `assetImageUrls` esta **ausente** no body enviado para `generate-image`. Mesmo que estivesse presente, o sistema envia URLs externas como `image_url` parts -- o Lovable AI Gateway pode nao conseguir buscar essas URLs.

A referencia Atlas-new-creators faz diferente: **busca cada imagem de referencia, converte para base64, e envia como inline data** direto no request para a IA. Isso garante que a IA realmente "veja" as imagens.

## Plano

### 1. Edge Function `generate-image`: Fetch + base64 dos assets
Em vez de enviar URLs como `image_url` parts, a funcao deve:
- Receber `assetImageUrls` (array de URLs)
- Para cada URL, fazer `fetch`, converter o `ArrayBuffer` para base64
- Enviar como `image_url` com data URI (`data:image/png;base64,...`)
- Limitar a 5 imagens de referencia para nao estourar o contexto

### 2. Frontend `MediaStep.tsx`: Garantir envio de URLs
- Verificar que `selectedAssets.map(a => a.image_url)` esta produzindo URLs validas
- Filtrar URLs vazias/null antes de enviar

## Arquivos alterados
| Arquivo | Mudanca |
|---|---|
| `supabase/functions/generate-image/index.ts` | Fetch assets como base64 inline data (como na referencia) |
| `src/components/pipeline/MediaStep.tsx` | Filtrar URLs vazias dos assets |

## Resultado
- Assets selecionados serao realmente "vistos" pela IA como imagens de referencia
- Personagem Atlas aparecera nas cenas relevantes

