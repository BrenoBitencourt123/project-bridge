

# Atlas Studio — Plano de Implementação

## Visão Geral

Construir do zero o Atlas Studio: plataforma de produção de vídeos educacionais (ENEM) com pipeline de 4 etapas (Roteiro → Segmentos → Mídia → Export). Tema dark, mobile-first, com Supabase para backend.

## Pré-requisito: Supabase

O projeto precisa de Lovable Cloud habilitado para banco de dados, auth, storage e edge functions. As API keys externas (GOOGLE_AI_API_KEY, ELEVENLABS_API_KEY, OPENAI_API_KEY) precisarão ser adicionadas como secrets.

---

## Fase 1 — Infraestrutura e Auth

**Banco de dados (migrations):**
- Enum `project_status`, `moment_type`, `media_status`
- Tabela `profiles` (id, user_id FK, display_name, voice_settings JSONB, timestamps) com RLS e trigger auto-create
- Tabela `projects` (id, user_id FK, title, subject, topic, difficulty_level, target_duration, raw_script, status, thumbnail_url, timestamps) com RLS
- Tabela `segments` (id, project_id FK, sequence_number, narration, image_prompt, symbolism, moment_type, duration_estimate, image_url, audio_url, image_status, audio_status, timestamps) com RLS via join em projects
- Storage buckets: `segment-images` (público), `segment-audio` (público)

**Auth e contexto:**
- `src/contexts/AuthContext.tsx` — provider com onAuthStateChange + getSession
- `src/types/atlas.ts` — interfaces VoiceSettings, Segment, Project
- Componente `ProtectedRoute` com redirect para /auth

**Arquivos criados:** ~5 arquivos + 1 migration

## Fase 2 — Páginas e Navegação

**Routing (App.tsx):**
- `/auth` → AuthPage (pública, redireciona se logado)
- `/` → Dashboard (protegida)
- `/project/:id` → ProjectPipeline (protegida)
- `/settings` → VoiceSettings (protegida)
- `*` → NotFound

**AuthPage:**
- Toggle Login/Cadastro, campos email + senha, branding "Atlas Studio" com ícone Zap

**Dashboard:**
- Header fixo com logo, botão Settings, botão Sair
- Grid responsivo de project cards (thumbnail, badge status, título, preview, data)
- Dialog "Novo Projeto" com abas: colar roteiro / gerar com IA
- Dialog "Gerar Thumbnail"

**ProjectPipeline:**
- Header sticky com botão voltar, título editável inline
- StepperHeader (4 etapas com navegação baseada em maxStep)
- 4 sub-componentes de etapa

**VoiceSettings:**
- Dropdown de vozes (via list-voices), sliders, toggles, dropdowns de modelo/idioma/formato
- Salva em profiles.voice_settings

**Arquivos criados:** ~12 componentes

## Fase 3 — Componentes do Pipeline

**ScriptStep:** Textarea, contador palavras/duração, botão gerar IA, botão salvar & avançar

**SegmentsStep:** Botão segmentar, lista de SegmentCards, botão salvar & avançar

**SegmentCard:** Colapsável, badges coloridos por moment_type, textareas editáveis, status indicators, botões gerar imagem/áudio individuais

**MediaStep:**
- HUD sticky: 4 botões de ação (regenerar prompts, gerar todas imagens, gerar todos áudios, enviar áudio)
- Progress bars de imagens e áudios
- Fluxo de upload de áudio: aceita múltiplos arquivos, transcreve via Whisper, merge de alinhamentos, split client-side
- SegmentCards com preview de mídia

**ExportStep:** Status, lista de arquivos, botão baixar ZIP via JSZip

**Arquivos criados:** ~6 componentes

## Fase 4 — Edge Functions

Todas com `verify_jwt = false` e CORS headers.

| Função | Descrição | API externa |
|--------|-----------|-------------|
| `generate-script` | Gera roteiro educacional | Gemini (GOOGLE_AI_API_KEY) |
| `segment-script` | Divide roteiro em 70-95 segmentos | Gemini com responseSchema |
| `regenerate-prompts` | Regenera image prompts | Gemini |
| `generate-image` | Gera imagem estilo esboço à mão | Gemini 3 Pro Image |
| `generate-audio` | Gera áudio de 1 segmento | ElevenLabs TTS |
| `generate-audio-batch` | Gera áudio completo com timestamps | ElevenLabs /with-timestamps |
| `list-voices` | Lista vozes PT disponíveis | ElevenLabs |
| `generate-thumbnail` | Gera thumbnail do projeto | Gemini Image |
| `transcribe-audio` | Transcreve áudio enviado | OpenAI Whisper |

**Arquivos criados:** 9 edge functions + config.toml

## Fase 5 — Utilitários Client-Side (Audio Split)

**`src/lib/audio-splitter.ts`:**
- `splitAudioAtCutPoints` — Web Audio API, decodifica e fatia em WAV blobs
- `splitChunkedAudioAtCutPoints` — para múltiplos chunks base64 (ElevenLabs chunked)
- `audioBufferToWav` — converte para WAV PCM 16-bit

**`src/lib/find-cut-points.ts`:**
- `findSegmentCutPoints` — encontra tempos de corte comparando narrações dos segmentos com o alinhamento caractere-a-caractere
- Estratégia 1: busca direta no texto do alinhamento (Whisper)
- Estratégia 2: mapeamento proporcional no texto original (fallback ElevenLabs)
- Suporta merge de alinhamentos de múltiplos arquivos de áudio importados

**Fluxo de importação de áudio (feature crítica):**

```text
Usuário importa 2+ arquivos MP3 do ElevenLabs
        ↓
Cada arquivo → transcribe-audio (Whisper) → alignment por arquivo
        ↓
Merge dos alignments (offset de tempo acumulado)
        ↓
findSegmentCutPoints(rawScript, mergedAlignment, segments)
        ↓
splitChunkedAudioAtCutPoints(arquivos, cutTimes)
        ↓
Upload de cada WAV fatia → segment-audio bucket
        ↓
Atualiza audio_url + audio_status de cada segmento
```

## Fase 6 — Tema Dark e Polish

- `index.css` com variáveis CSS para tema dark (fundo #0a0a0a)
- Responsividade mobile-first em todas as páginas
- Toast notifications para feedback de operações
- Loading states e error handling em todas as chamadas

---

## Ordem de Implementação

Devido ao tamanho do projeto, recomendo implementar em etapas iterativas:

1. **Primeiro**: Infraestrutura (DB + Auth + tipos + tema dark + routing)
2. **Segundo**: Dashboard + AuthPage + dialogs
3. **Terceiro**: Pipeline (ScriptStep + SegmentsStep + SegmentCard + StepperHeader)
4. **Quarto**: Edge functions (generate-script, segment-script, regenerate-prompts)
5. **Quinto**: MediaStep + edge functions de mídia (generate-image, generate-audio-batch, list-voices)
6. **Sexto**: Audio import (transcribe-audio + audio-splitter + find-cut-points)
7. **Sétimo**: ExportStep + VoiceSettings + generate-thumbnail

Cada etapa produz algo funcional e testável.

## Notas Técnicas

- Secrets necessários: GOOGLE_AI_API_KEY, ELEVENLABS_API_KEY, OPENAI_API_KEY (serão solicitados antes de criar edge functions que os usam)
- JSZip já existe como dependência potencial, será adicionado
- O split de áudio usa Web Audio API nativa do browser, sem dependências extras
- Para o fluxo de múltiplos áudios importados: o merge de alinhamentos soma o offset de duração de cada arquivo anterior ao calcular os tempos absolutos

