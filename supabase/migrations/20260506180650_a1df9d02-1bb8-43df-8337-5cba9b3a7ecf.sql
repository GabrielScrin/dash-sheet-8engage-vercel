
-- 1) Restrict EXECUTE on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 2) Allow anonymous inserts into access_logs ONLY for valid active share tokens
CREATE POLICY "Anyone can insert access logs for active share tokens"
ON public.access_logs
FOR INSERT
TO anon, authenticated
WITH CHECK (
  share_token_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.share_tokens st
    WHERE st.id = access_logs.share_token_id
      AND st.project_id = access_logs.project_id
      AND st.is_active = true
      AND (st.expires_at IS NULL OR st.expires_at > now())
  )
);

-- 3) Move google_refresh_token off the client-readable profiles table.
-- Migrate any existing tokens into service_tokens (provider='google'),
-- then drop the column from profiles.
INSERT INTO public.service_tokens (user_id, provider, access_token, refresh_token, token_type, scope)
SELECT
  p.user_id,
  'google',
  '', -- access tokens are short-lived; refreshed on demand
  p.google_refresh_token,
  'Bearer',
  'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly'
FROM public.profiles p
WHERE p.google_refresh_token IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.service_tokens st
    WHERE st.user_id = p.user_id AND st.provider = 'google'
  );

ALTER TABLE public.profiles DROP COLUMN IF EXISTS google_refresh_token;
