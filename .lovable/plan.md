

# Painel de Custo Estimado por Etapa do Pipeline

## Resumo dos custos reais por API

| Etapa | API | Chave usada | Custo aproximado |
|---|---|---|---|
| Gerar Roteiro | Gemini 2.5 Flash | `GOOGLE_AI_API_KEY` (sua) | ~$0.15/1M tokens input, ~$0.60/1M output |
| Segmentar Roteiro | Gemini 1.5 Flash | `GOOGLE_AI_API_KEY` (sua) | ~$0.075/1M tokens input |
| Gerar Prompts | Gemini | `GOOGLE_AI_API_KEY` (sua) | ~$0.15/1M tokens |
| Gerar Imagens | Gemini 3 Pro Image | `LOVABLE_API_KEY` (Lovable) | Incluso nos créditos Lovable |
| Gerar Áudio | ElevenLabs | `ELEVENLABS_API_KEY` (sua) | ~$0.30/1K caracteres |
| Transcrever Áudio | OpenAI Whisper | `OPENAI_API_KEY` (sua) | ~$0.006/minuto |

## Exemplo para vídeo de 8 min (~1760 palavras)

- **Roteiro (Gemini)**: ~$0.002
- **Segmentação (Gemini)**: ~$0.001
- **Prompts (Gemini)**: ~$0.001
- **Imagens (Lovable AI)**: $0.00
- **Áudio (ElevenLabs)**: ~$2.50-3.50 (8000-12000 chars)
- **Transcrição (Whisper)**: ~$0.05
- **Total estimado**: ~$2.50-3.60

## Plano de implementação

### 1. Criar `src/components/pipeline/CostEstimateCard.tsx`
Card compacto com ícone de DollarSign mostrando breakdown por etapa:
- Recebe props: `wordCount`, `charCount`, `subSceneCount`, `audioDurationMin`, `step` (current pipeline step)
- Calcula custos por fórmulas simples
- Mostra cada linha com nome da API, custo estimado, e badge "sua chave" ou "incluso"
- Linha de total no rodapé

### 2. Integrar nos steps do pipeline
- **ScriptStep**: Mostrar custo da geração de roteiro (Gemini) baseado em palavras
- **SegmentsStep**: Custo de segmentação + estimativa de imagens e áudio que virão (baseado no número de sub-cenas e total de caracteres de narração)
- **MediaStep**: Custo real de imagens (zero) + custo do áudio ElevenLabs baseado nos caracteres totais das narrações
- **ExportStep**: Resumo do custo total acumulado do projeto

### Arquivos
- **Novo**: `src/components/pipeline/CostEstimateCard.tsx`
- **Editados**: `ScriptStep.tsx`, `SegmentsStep.tsx`, `MediaStep.tsx`, `ExportStep.tsx`

