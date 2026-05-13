
CREATE TABLE public.project_google_ads_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  refresh_token text NOT NULL,
  customer_id text,
  customer_name text,
  login_customer_id text,
  currency_code text,
  time_zone text,
  last_validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_google_ads_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own google ads connections"
  ON public.project_google_ads_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own google ads connections"
  ON public.project_google_ads_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own google ads connections"
  ON public.project_google_ads_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own google ads connections"
  ON public.project_google_ads_connections FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.project_google_ads_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
