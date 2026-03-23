

# Thumbnail não atualiza no Dashboard

## Problema

A URL da thumbnail é sempre a mesma (`{projectId}/thumbnail.png`) — quando uma nova é gerada com `upsert: true`, o browser usa a versão em cache porque a URL não mudou.

## Solução

Dois pontos de correção:

### 1. `supabase/functions/generate-thumbnail/index.ts`
Adicionar um timestamp como query param na URL salva no banco, forçando cache-bust:
```
const thumbnailUrl = urlData.publicUrl + `?t=${Date.now()}`;
```

### 2. `supabase/functions/generate-thumbnail/index.ts` — Prompt atualizado (plano aprovado anterior)
Aproveitar para aplicar o prompt refinado com fundo de lousa/fórmulas conforme aprovado na conversa anterior.

### Resultado
Ao gerar uma nova thumbnail, a URL salva no banco terá um timestamp diferente, forçando o browser a buscar a versão nova.

