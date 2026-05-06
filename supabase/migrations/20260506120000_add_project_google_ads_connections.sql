CREATE TABLE IF NOT EXISTS public.project_google_ads_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  customer_id TEXT,
  login_customer_id TEXT,
  customer_name TEXT,
  currency_code TEXT,
  time_zone TEXT,
  last_validated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

ALTER TABLE public.project_google_ads_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own project google ads connections"
  ON public.project_google_ads_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own project google ads connections"
  ON public.project_google_ads_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own project google ads connections"
  ON public.project_google_ads_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own project google ads connections"
  ON public.project_google_ads_connections FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_project_google_ads_connections_updated_at
  BEFORE UPDATE ON public.project_google_ads_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
