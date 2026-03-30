

# Divisão inteligente de sub-cenas via IA

## Problema atual
O `splitIntoSubScenes` divide mecanicamente por contagem de palavras e pontuação. Isso gera sub-cenas que não respeitam mudanças de ideia, visual ou raciocínio — resultando em áudios longos demais ou cortes no meio de um conceito.

## Solução
Substituir a divisão mecânica por uma chamada à IA que analisa o conteúdo semanticamente e divide cada cena em sub-cenas baseadas nos critérios que você definiu:
- Mudança de foco da explicação
- Mudança de imagem ideal
- Mudança de exemplo
- Nova informação que precisa respirar
- Virada de raciocínio

## Fluxo

```text
Roteiro com CENA → parse local (7 cenas) → IA divide cada cena em sub-cenas semânticas
Roteiro sem CENA → adapt-script (cria cenas) → IA divide cada cena em sub-cenas semânticas
```

## Mudanças

### 1. Nova edge function `split-sub-scenes` 
Uma função dedicada que recebe a narração de UMA cena e retorna as sub-cenas. O prompt inclui todos os seus critérios:

- Cada sub-cena = 1 ideia + 1 imagem + 1 trecho de áudio
- Cortar quando muda o foco, o visual, o exemplo ou o raciocínio
- Cada sub-cena deve caber em ~7-12 segundos de áudio (15-30 palavras)
- Gerar o `image_prompt` para cada sub-cena já nesta etapa

Retorna JSON: `{ sub_scenes: [{ narration_segment, image_prompt }] }`

### 2. `src/components/pipeline/SegmentsStep.tsx` — Chamar a nova função
Após criar os segmentos (tanto via `handleSegment` quanto `handleAdapt`):
- Em vez de chamar `splitIntoSubScenes` localmente, chamar a edge function `split-sub-scenes` para cada segmento
- Mostrar progresso: "Dividindo cena 3/7 em sub-cenas..."
- Os prompts de imagem já vêm preenchidos (resolve o problema de prompts vazios)

### 3. `src/lib/split-sub-scenes.ts` — Mantido como fallback
A função local continua existindo como fallback caso a IA falhe em algum segmento.

## Resultado
- Sub-cenas divididas por significado, não por contagem de palavras
- Prompts de imagem gerados automaticamente na segmentação
- Cada sub-cena acompanha um passo mental do aluno
- Áudios de ~7-12s por sub-cena, sem surpresas de 2 minutos

## Arquivos

| Arquivo | Mudança |
|---|---|
| `supabase/functions/split-sub-scenes/index.ts` | Nova edge function com prompt semântico para dividir cenas em sub-cenas |
| `src/components/pipeline/SegmentsStep.tsx` | Substituir `splitIntoSubScenes` local pela chamada à edge function + progresso |

