

# Alinhamento com Referência (mantendo áudio e estilo atuais)

## O que será mantido (sem alterações)
- **Áudio**: Fluxo atual (gera áudio completo do roteiro + fatia por timestamps de sub-cena)
- **Estilo visual**: Sketch com destaque em azul (estilo padrão atual)

## O que será implementado

### 1. Modo Single (painéis empilhados) — Redução de custos ~50%
A referência gera 2-3 sub-cenas numa **única imagem** empilhada verticalmente, depois recorta no frontend. Isso reduz o número de chamadas de API pela metade.

- `generate-image`: novo parâmetro `panelCount` (2-3). Quando presente, o prompt instrui a IA a gerar painéis empilhados separados por linha branca
- `MediaStep.tsx`: após receber a imagem, recorta em N partes iguais usando Canvas e atribui cada parte a uma sub-cena

### 2. Instrução de personagem mais forte
Atualizar o prompt de `generate-image` de "include them with the exact appearance described" para "draw them exactly like the reference images provided — maintaining the same face, hair, and clothing style"

### 3. Formatação TTS na segmentação
Adicionar regra no prompt do `segment-script`: números por extenso, siglas fonéticas (ex: CDI → "cedê i", SELIC → "selic"). Melhora a qualidade do áudio gerado pela ElevenLabs.

### 4. Fallback de modelo em segment-script e generate-image
Implementar retry automático com `gemini-2.5-flash` como fallback quando o modelo primário falha ou dá timeout.

### 5. Timeout em segment-script
Adicionar AbortController com deadline de 55s (já existe em `generate-image`, falta em `segment-script`).

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `supabase/functions/generate-image/index.ts` | Modo single (painéis), instrução de personagem, fallback |
| `supabase/functions/segment-script/index.ts` | Formatação TTS, timeout 55s, fallback de modelo |
| `src/components/pipeline/MediaStep.tsx` | Lógica de recorte de painéis no Canvas, agrupamento de sub-cenas para modo single |

## Resultado
- ~50% menos chamadas de API para imagens (modo single)
- Assets influenciam imagens com instrução mais forte
- Áudio com pronúncia melhor (formatação TTS)
- Sistema mais resiliente (timeout + fallback em todas as funções)

