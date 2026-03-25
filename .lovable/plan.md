

# Plano: Ajustar duração das sub-cenas para 4-8 segundos

## Contexto
Em português brasileiro, a velocidade média de narração é ~2.5 palavras/segundo. Para atingir o range de 4-8 segundos por sub-cena:
- **Mínimo**: 10 palavras (~4s)
- **Máximo**: 20 palavras (~8s)

## Alterações em `src/lib/split-sub-scenes.ts`

1. **Novos thresholds de divisão** — Calcular `numSubScenes` dividindo o total de palavras pelo alvo de ~15 palavras (meio do range 10-20), com mínimo 1 e máximo ilimitado (não mais limitado a 4):
   - `numSubScenes = Math.max(1, Math.round(wordCount / 15))`

2. **Mínimo de merge** — Alterar `MIN_WORDS` de 15 para **10** (equivalente a ~4 segundos)

3. **Máximo por sub-cena** — Após o split, verificar se alguma sub-cena tem mais de 20 palavras e subdividir novamente se necessário

4. **Remover limite de 4 PERSPECTIVE_HINTS** — Expandir o array ou reutilizar ciclicamente para suportar mais sub-cenas

## Resultado esperado
Cada sub-cena terá entre 10 e 20 palavras (~4-8 segundos de narração), gerando mais sub-cenas por segmento mas com duração mais uniforme e curta.

