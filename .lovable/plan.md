

# Plano: Alinhar Sistema com Referência Atlas-new-creators

## Diferenças Principais Identificadas

| Aspecto | Nosso Sistema Atual | Referência Atlas-new-creators |
|---|---|---|
| **Edge Functions de IA** | 3 separadas (`generate-script`, `segment-script`, `regenerate-prompts`) usando `GOOGLE_AI_API_KEY` | 1 unificada (`ai-content`) usando `LOVABLE_API_KEY` com fallback + timeout handling |
| **Geração de Imagem** | Salva no Storage, retorna URL pública | Retorna `data:base64` direto, sem Storage (front-end gerencia) |
| **Imagem: reference images** | Usa `assetDescriptions` (texto) | Envia **imagens reais** como `image_url` parts no request |
| **Imagem: estilos** | Estilo fixo (sketch azul) | Múltiplos estilos selecionáveis (sketch laranja, impacto/comic, limpo, vibrant) |
| **Imagem: panels** | 1 imagem por sub-cena | Modo `single` gera 1 imagem com 2-3 painéis empilhados verticalmente (depois recorta) |
| **Segmentação** | IA retorna blocos com `momentType` + `maxSubScenes` | IA retorna `video_script[]` com `{time, narration, visual}` — sem momentType |
| **Sub-cenas** | Mesma lógica de faixas de palavras (idêntica) | Mesma lógica (<25→1, <50→2, <75→3, 75+→4) |
| **Áudio** | ElevenLabs `with-timestamps` + split por sub-cena | ElevenLabs individual por sub-cena (1 request por audio) |
| **Model fallback** | Nenhum | Retry automático com modelo fallback + timeout handling |

## O que faz sentido adotar

### 1. Migrar `generate-script` e `regenerate-prompts` para Lovable AI Gateway
- Elimina uso da `GOOGLE_AI_API_KEY` em **todas** as edge functions de texto
- Custo zero para o usuário em geração de roteiro, segmentação e prompts
- Adicionar timeout handling e model fallback como na referência

### 2. Melhorar `generate-image` com referência de imagens reais (não só texto)
- Atualmente os assets são enviados como **descrições textuais** — a IA não vê as imagens
- Na referência, as imagens dos assets são enviadas como `image_url` parts no request
- Isso é o motivo dos assets "não influenciarem" as imagens geradas
- Implementar: buscar a URL real do asset e enviar como `image_url` no multimodal request

### 3. Adicionar estilos de imagem selecionáveis
- Atual: estilo fixo (sketch azul em papel bege)
- Referência: 4 estilos — sketch (laranja), impacto/comic, limpo, vibrant
- Permitir ao usuário escolher o estilo no `StyleTemplateSelector`

### 4. Adicionar timeout + fallback nos requests de IA
- Referência usa AbortController com deadline de 50-55s
- Se o modelo primário falha, tenta um modelo fallback (gemini-2.5-flash)
- Previne edge functions travando por timeout silencioso

### 5. **NÃO** mudar a segmentação
- A lógica de sub-cenas por faixas de palavras é **idêntica** nas duas bases
- O `momentType` + `maxSubScenes` que adicionamos é uma **melhoria** sobre a referência (que não tem)
- Manter como está

### 6. **NÃO** mudar o fluxo de áudio
- Nosso sistema gera 1 áudio completo e fatia por timestamps — mais eficiente e natural
- A referência gera 1 request por sub-cena — mais caro e com cortes menos naturais
- Manter como está

## Arquivos Alterados

| Arquivo | Mudança |
|---|---|
| `supabase/functions/generate-script/index.ts` | Migrar para Lovable AI Gateway + adicionar timeout/fallback |
| `supabase/functions/regenerate-prompts/index.ts` | Migrar para Lovable AI Gateway + adicionar timeout/fallback |
| `supabase/functions/generate-image/index.ts` | Enviar imagens reais dos assets (não só texto) + adicionar estilos |
| `src/components/pipeline/MediaStep.tsx` | Passar URLs dos assets (não só descrições) para generate-image |
| `src/components/pipeline/AssetReferenceSelector.tsx` | Incluir `image_url` nos assets selecionados |
| `src/components/pipeline/CostEstimateCard.tsx` | Atualizar: todas as etapas de texto agora são custo zero |

## Resultado Esperado
- **Custo zero** em todas as chamadas de IA de texto (roteiro, segmentação, prompts)
- **Assets realmente influenciam** as imagens (enviados como imagens, não texto)
- **Resiliência**: timeout + fallback evita erros silenciosos
- Custos do usuário: apenas ElevenLabs (áudio) e Whisper (transcrição)

