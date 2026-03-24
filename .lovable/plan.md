

# Plano: Realtime Progress + Templates Visuais + Analytics Dashboard + Delete Projetos + Sistema de Assets

## 1. Delete de Projetos no Dashboard

**Arquivo:** `src/pages/Dashboard.tsx`
- Botão de lixeira no hover de cada card (ao lado do "Thumbnail")
- AlertDialog de confirmação antes de deletar
- Mutation que deleta o projeto do banco (cascade já cuida de segments/sub_scenes)
- Limpar arquivos do storage (segment-images e segment-audio) com prefix `{projectId}/`

---

## 2. Fila de Renderização em Tempo Real

**Migração SQL:** Habilitar realtime na tabela `sub_scenes`
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.sub_scenes;
```

**Arquivo:** `src/components/pipeline/MediaStep.tsx`
- Subscrever a mudanças na tabela `sub_scenes` via Supabase Realtime
- Quando uma sub_scene atualiza `image_status` ou `audio_status`, atualizar o estado local automaticamente
- Barra de progresso atualiza em tempo real sem polling
- Indicador visual por sub-cena: spinner (generating), check (done), X (error)

---

## 3. Templates de Estilo Visual

**Migração SQL:** Nova tabela `image_style_templates`
```sql
CREATE TABLE public.image_style_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  prompt_prefix text NOT NULL,
  is_default boolean DEFAULT false,
  user_id uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.image_style_templates ENABLE ROW LEVEL SECURITY;
-- RLS: templates default (user_id IS NULL) visíveis a todos autenticados
-- Templates do usuário visíveis apenas ao dono
```

**Templates pré-populados (seed na migração):**
- "Lousa Educacional" — fundo escuro, sketch a giz, fórmulas (estilo atual)
- "Flat Design Colorido" — ilustração vetorial, cores vibrantes, fundo limpo
- "Realista Cinematográfico" — fotorrealista, iluminação dramática
- "Cartoon/Mangá" — estilo anime/cartoon, personagens expressivos

**Novo componente:** `src/components/pipeline/StyleTemplateSelector.tsx`
- Dropdown/grid para escolher template antes de gerar imagens
- Preview do nome + descrição do estilo

**Arquivos modificados:**
- `src/components/pipeline/MediaStep.tsx` — selector de template; passa `stylePrefix` ao gerar
- `supabase/functions/generate-image/index.ts` — recebe `stylePrefix` e injeta no prompt
- `src/pages/ProjectPipeline.tsx` — estado do template selecionado

---

## 4. Dashboard com Analytics

**Nova página:** `src/pages/AnalyticsPage.tsx`
- Cards com métricas: total de projetos, projetos por status, total de sub-cenas geradas
- Queries diretas ao banco (count de projects por status, count de sub_scenes por status)
- Gráfico simples (barras) com distribuição de projetos por status usando Recharts (já disponível)

**Arquivo:** `src/App.tsx` — nova rota `/analytics`
**Arquivo:** `src/pages/Dashboard.tsx` — link "Analytics" no header

---

## 5. Sistema de Assets Visuais

**Migração SQL:**
```sql
CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  category text DEFAULT 'general',
  image_url text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
-- RLS: CRUD apenas para o próprio user_id
```

**Novo bucket storage:** `user-assets` (público)

**Nova página:** `src/pages/AssetsPage.tsx`
- Grid de assets com imagem, nome e categoria
- Upload de nova imagem + nome descritivo + categoria (personagem, objeto, cenário)
- Botão de deletar asset
- Rota: `/assets`

**Integração na geração de imagens:**
- `src/components/pipeline/MediaStep.tsx` — seção para selecionar assets de referência antes de gerar
- `supabase/functions/generate-image/index.ts` — receber `assetDescriptions` e incluir no prompt como referências visuais (ex: "Include these visual elements: [nome]: [descrição]")
- `src/pages/Dashboard.tsx` (dialog de thumbnail) — opção de selecionar assets

**Arquivo:** `src/App.tsx` — nova rota `/assets`
**Arquivo:** `src/pages/Dashboard.tsx` — link "Assets" no header

---

## Detalhes Técnicos

- **Realtime:** `supabase.channel('sub-scenes-progress').on('postgres_changes', ...)` filtrando por project_id
- **Templates seed:** INSERT na própria migração com `user_id = NULL` para templates globais
- **Analytics:** Queries com `.select('status', { count: 'exact' })` agrupando por status
- **Assets no prompt:** Passados como texto descritivo (não multimodal) para manter simplicidade — a IA interpreta a descrição textual do asset

