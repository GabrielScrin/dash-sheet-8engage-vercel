## Google Ads Secure Setup

Nunca coloque `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DEVELOPER_TOKEN` ou `refresh_token` no frontend.

### 1. Salvar secrets globais da Edge Function

```bash
supabase secrets set GOOGLE_CLIENT_ID="SEU_CLIENT_ID"
supabase secrets set GOOGLE_CLIENT_SECRET="SEU_CLIENT_SECRET"
supabase secrets set GOOGLE_DEVELOPER_TOKEN="SEU_DEVELOPER_TOKEN"
```

Ou em uma única linha:

```bash
supabase secrets set \
  GOOGLE_CLIENT_ID="SEU_CLIENT_ID" \
  GOOGLE_CLIENT_SECRET="SEU_CLIENT_SECRET" \
  GOOGLE_DEVELOPER_TOKEN="SEU_DEVELOPER_TOKEN"
```

### 2. Registrar a conexão por projeto no banco

Preencha `PROJECT_ID`, `USER_ID`, `REFRESH_TOKEN`, `CUSTOMER_ID` e opcionalmente `LOGIN_CUSTOMER_ID`.

```sql
insert into public.project_google_ads_connections (
  project_id,
  user_id,
  refresh_token,
  customer_id,
  login_customer_id
) values (
  'PROJECT_ID',
  'USER_ID',
  'REFRESH_TOKEN',
  'CUSTOMER_ID',
  'LOGIN_CUSTOMER_ID'
)
on conflict (project_id) do update set
  refresh_token = excluded.refresh_token,
  customer_id = excluded.customer_id,
  login_customer_id = excluded.login_customer_id,
  updated_at = now();
```

Se ainda não souber o `customer_id`, pode inserir `null` e depois usar a tela do projeto para listar contas acessíveis:

```sql
insert into public.project_google_ads_connections (
  project_id,
  user_id,
  refresh_token,
  customer_id,
  login_customer_id
) values (
  'PROJECT_ID',
  'USER_ID',
  'REFRESH_TOKEN',
  null,
  'LOGIN_CUSTOMER_ID'
)
on conflict (project_id) do update set
  refresh_token = excluded.refresh_token,
  customer_id = excluded.customer_id,
  login_customer_id = excluded.login_customer_id,
  updated_at = now();
```

### 3. Deploy da função

```bash
supabase functions deploy google-ads-api
```
