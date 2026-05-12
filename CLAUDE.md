# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server (Vite)
npm run build        # Produção
npm run lint         # ESLint
npm run test         # Vitest (single run)
npm run test:watch   # Vitest (watch)
```

Para rodar um teste específico:
```bash
npx vitest run src/test/example.test.ts
```

## Stack

- **Frontend**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui (`src/components/ui/` — não editar diretamente)
- **Backend**: Supabase (PostgreSQL + Edge Functions em Deno)
- **Auth**: Google OAuth via Supabase
- **Data fetching**: TanStack React Query
- **Routing**: React Router v6
- **Animações**: Framer Motion + GSAP

Alias de importação: `@/` → `src/`

## Arquitetura

### Rotas

```
/                     → página de landing (Index)
/login                → autenticação Google
/app/projects         → lista de dashboards (rota protegida)
/app/projects/:id/config   → configuração wizard
/app/projects/:id/preview  → preview do dashboard
/app/meta/callback    → callback OAuth do Meta Ads
/app/settings         → configurações do usuário
/view/:token          → dashboard público compartilhado (sem autenticação)
```

`ProtectedRoute` redireciona para `/login` se o usuário não estiver autenticado.

### Contextos globais

- `AuthContext` (`src/contexts/AuthContext.tsx`): gerencia sessão Supabase, Google OAuth (scopes: Sheets read + Drive metadata), e salva tokens na tabela `service_tokens` ao fazer login.
- `ThemeContext` (`src/contexts/ThemeContext.tsx`): tema light/dark via `next-themes`.

### Fluxo de configuração de projeto (wizard)

`ProjectConfig` implementa um stepper com etapas diferentes por tipo de fonte:

- **Google Sheets**: Fonte → Conexão (planilha + abas) → Publicar
- **Meta Ads**: Fonte → Conexão (conta Meta + conta Google Ads) → Integrações → Publicar

A etapa "Conexão" para sheets espera 4 abas obrigatórias na planilha: `sheet_perpetua`, `sheet_distribuicao`, `sheet_consideracao`, `sheet_criativos` (salvas em `projects.source_config` JSONB). Opcionalmente: `sheet_google_descoberta`, `sheet_google_consideracao`.

### Dashboard público (`/view/:token`)

1. Chama a Edge Function `validate-share-token` com o token da URL (e senha se necessário).
2. Se válido, renderiza `DashboardView` com `projectId` e `shareToken`.
3. `DashboardView` é o componente central que agrega todos os widgets: `BigNumberCard`, `WeeklyComparisonTable`, `CreativePerformanceTable`, `FunnelVisualization`, `DashboardFilters`.

### Leitura de dados de planilhas

`useSheetData` (hook em `src/hooks/useSheetData.ts`) invoca a Edge Function `google-sheets` passando:
- `x-google-token`: provider_token da sessão Supabase (token Google do usuário)
- `x-share-token`: share token (para visualizações públicas sem login)

Cache React Query: 5 min stale, 10 min gc.

### Edge Functions (Supabase/Deno)

| Função | Propósito |
|---|---|
| `google-sheets` | Lê dados de planilhas Google via API |
| `meta-auth` | OAuth flow do Meta Ads (authorize + callback) |
| `meta-api` | Lista contas de anúncios e dados do Meta |
| `google-ads-api` | Valida conexão e lista contas do Google Ads |
| `create-share-token` | Cria link de compartilhamento com senha opcional |
| `validate-share-token` | Valida token público e retorna dados do projeto |
| `payment-attribution` | Integração de atribuição de pagamento |

Todas com `verify_jwt = false` no `supabase/config.toml`.

## Banco de dados

Todas as tabelas têm RLS ativo. Tabelas principais:

| Tabela | Descrição |
|---|---|
| `profiles` | Dados do usuário sincronizados do Google OAuth |
| `projects` | Configuração dos dashboards (inclui `source_type`, `source_config` JSONB) |
| `column_mappings` | Mapeamento de colunas da planilha para o dashboard |
| `share_tokens` | Links de compartilhamento (com senha opcional e validade) |
| `access_logs` | Logs de acesso aos dashboards públicos |
| `service_tokens` | Tokens OAuth do Meta e Google por usuário |
| `project_google_ads_connections` | Credenciais do Google Ads por projeto (inseridas via SQL manualmente) |

### Google Ads — setup manual necessário

A conexão Google Ads não tem UI de autorização OAuth. O `refresh_token` precisa ser inserido direto via SQL na tabela `project_google_ads_connections`. Depois disso a UI permite validar e listar contas acessíveis.

Secrets obrigatórias na Edge Function: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DEVELOPER_TOKEN`.

## Variáveis de ambiente

```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Secrets do backend ficam nas Edge Functions do Supabase (não no `.env` do frontend).
