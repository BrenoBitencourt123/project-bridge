

# Corrigir qualidade dos prompts de imagem na `split-sub-scenes`

## Problemas identificados

1. **Prompts em inglês** — Nada no SYSTEM_PROMPT obriga PT-BR nos image_prompt
2. **Prompts repetidos** — Subcenas da mesma cena recebem o mesmo prompt com sufixo de ângulo ("vista frontal", "close-up"). A IA está duplicando em vez de criar composições visuais distintas
3. **Sem identidade Atlas** — Exemplos mencionam "flat design", "cinematográfico" em vez do estilo sketch/papel bege
4. **Estilo duplicado** — A `generate-image` já aplica estilo sketch + ângulo de câmera, então o image_prompt NÃO precisa incluir estilo nem ângulo — deve focar 100% no CONTEÚDO VISUAL

## Solução

### `supabase/functions/split-sub-scenes/index.ts` — Reescrever seção de image_prompt no SYSTEM_PROMPT

Mudanças no prompt:
- **Obrigar PT-BR** nos image_prompt
- **Remover ângulo de câmera do prompt** — a `generate-image` já faz isso automaticamente via `CAMERA_ANGLES`
- **Remover menção a estilo visual** — a `generate-image` já aplica sketch/impacto via `STYLE_PROMPTS`
- **Foco 100% em conteúdo** — descrever O QUE aparece na imagem (objetos, pessoas, ações, dados, metáforas), não COMO é enquadrado ou estilizado
- **Regra anti-repetição** — cada subcena DEVE ter composição visual diferente: objetos diferentes, cenário diferente, ou momento diferente
- **Novos exemplos** focados em conteúdo concreto em PT-BR:
  - "Mão segurando urna transparente com 5 bolas (3 azuis, 2 vermelhas). Seta amarela aponta para as bolas azuis com '3/5' ao lado."
  - "Tela dividida: esquerda mostra cálculo errado riscado em vermelho; direita mostra cálculo correto em verde com checkmark."
  - "Adolescente em mesa de estudos com expressão de eureka, lâmpada acesa sobre a cabeça. Caderno aberto com fórmula P = n(A)/n(S) destacada."

### `supabase/functions/regenerate-prompts/index.ts` — Alinhar regras

- Adicionar mesma instrução de foco em conteúdo (sem estilo, sem ângulo)
- Obrigar PT-BR
- Adicionar regra anti-repetição

## Por que funciona

A arquitetura já tem separação de responsabilidades:
- `split-sub-scenes` → decide O QUE mostrar (conteúdo)
- `generate-image` → decide COMO mostrar (estilo sketch + ângulo de câmera)

O problema é que `split-sub-scenes` está tentando fazer o trabalho de `generate-image` (incluindo ângulo e estilo) e fazendo mal. Ao remover essa duplicação, cada camada faz só o seu trabalho.

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `supabase/functions/split-sub-scenes/index.ts` | Reescrever regras de image_prompt: PT-BR, sem estilo/ângulo, foco em conteúdo, anti-repetição |
| `supabase/functions/regenerate-prompts/index.ts` | Alinhar com mesmas regras de conteúdo |

