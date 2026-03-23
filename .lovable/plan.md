

# Corrigir Sub-cenas Muito Curtas (Mínimo 5-7s)

## Problema

A função `splitIntoSubScenes` divide por contagem de palavras e sentenças, mas a distribuição de sentenças pode ser muito desigual — uma sub-cena pode ficar com apenas 1 frase curta (3-5 palavras ≈ 1 segundo de narração). Além disso, o `findSubSceneCutPoints` não impõe duração mínima entre cortes.

## Solução (2 arquivos)

### 1. `src/lib/split-sub-scenes.ts` — Garantir mínimo de palavras por sub-cena

- Aumentar os thresholds de palavras: `<30→1, <55→2, <80→3, 80+→4` (antes: 25/50/75)
- Após distribuir sentenças, validar que cada sub-cena tenha no mínimo ~15 palavras (~6 segundos a 150 palavras/min)
- Se uma sub-cena ficar abaixo do mínimo, mesclar com a anterior
- Isso evita sub-cenas de 1-3 palavras que resultam em imagens que "piscam"

### 2. `src/lib/find-cut-points.ts` — Impor duração mínima entre cortes

- Após calcular os cut points, adicionar validação de gap mínimo de 5 segundos
- Se dois cortes consecutivos estiverem a menos de 5s, mesclar eliminando o segundo corte
- Isso funciona como safety net mesmo que o split gere sub-cenas curtas

### Resultado esperado

Cada sub-cena terá entre ~5-15 segundos de narração, garantindo que as imagens fiquem tempo suficiente na tela sem "piscar".

