

# Prompts de Imagem em PT-BR + Instruções do Repo de Referência

## Problema

Os prompts de imagem (`imagePrompt`) estão sendo gerados em inglês pelo `segment-script` e `regenerate-prompts`. Quando o Gemini gera a imagem, qualquer texto visível (placas, fórmulas, rótulos) sai em inglês. Além disso, o `styleGuide` no `generate-image` é básico comparado ao repo de referência, que tem regras detalhadas sobre linguagem, composição e anti-narração.

## Mudanças

### 1. `segment-script/index.ts` — Prompts em PT-BR
- Adicionar instrução explícita: "O campo imagePrompt DEVE ser escrito em português brasileiro (PT-BR)"
- Adicionar regra: "Se a imagem tiver textos visíveis (rótulos, placas, fórmulas), eles devem estar em PT-BR"

### 2. `regenerate-prompts/index.ts` — Mesma regra PT-BR
- Adicionar instrução: "imagePrompt deve ser em PT-BR"
- Adicionar regra de textos visíveis em português

### 3. `generate-image/index.ts` — Style guide completo (inspirado no repo)
Substituir o `styleGuide` básico atual por instruções detalhadas do repo de referência:

**Regras adotadas do repo:**
- `CRITICAL LANGUAGE RULE`: Todo texto visível na imagem DEVE ser em PT-BR, NUNCA em inglês
- `ANTI-NARRATION TEXT RULE`: Nunca transcrever frases completas da narração — texto visível máximo 1-4 palavras (títulos, rótulos, valores numéricos)
- `ACRONYM RULE`: Acrônimos na forma abreviada correta, nunca soletrados foneticamente
- `COMPOSITION RULE`: Elemento principal no centro (60-70% do frame), contexto nas bordas
- Aspect ratio 16:9 (1920x1080) — widescreen obrigatório
- Nunca incluir nomes de marca/canal/logos
- Manter o estilo sketch em papel bege com azul como cor de destaque (ao invés de laranja do repo, mantendo a identidade do projeto)

**Prompt final montado:**
```
ABSOLUTE REQUIREMENT: 16:9 (1920x1080).
CRITICAL LANGUAGE RULE: ALL text in PT-BR. NEVER English.
ANTI-NARRATION TEXT RULE: Max 1-4 words visible.
Hand-drawn sketch on beige/cream paper, pencil cross-hatching,
grayscale with ONLY blue (#4A90E2) as accent.
COMPOSITION RULE: Main element centered (60-70%).
Scene: ${imagePrompt}
```

### 4. Arquivos alterados
- `supabase/functions/segment-script/index.ts` — 2 linhas no prompt
- `supabase/functions/regenerate-prompts/index.ts` — 2 linhas no prompt
- `supabase/functions/generate-image/index.ts` — substituir `styleGuide` por versão completa

