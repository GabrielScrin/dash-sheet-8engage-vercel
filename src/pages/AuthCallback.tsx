import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

function getSafeReturnTo(value: string | null) {
  if (!value) return '/app/projects';
  if (!value.startsWith('/')) return '/app/projects';
  if (value.startsWith('//')) return '/app/projects';
  return value;
}

function getHashParams(hash: string) {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return new URLSearchParams(raw);
}

export default function AuthCallback() {
  useEffect(() => {
    let active = true;

    const finishLogin = async () => {
      const url = new URL(window.location.href);
      const returnTo = getSafeReturnTo(url.searchParams.get('next'));
      const code = url.searchParams.get('code');
      const errorDescription = url.searchParams.get('error_description');
      const hashParams = getHashParams(url.hash);
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');

      if (errorDescription) {
        window.location.replace(`/login?error=${encodeURIComponent(errorDescription)}`);
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error('OAuth callback exchange failed:', error);
          window.location.replace(`/login?error=${encodeURIComponent(error.message)}`);
          return;
        }
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          console.error('OAuth callback setSession failed:', error);
          window.location.replace(`/login?error=${encodeURIComponent(error.message)}`);
          return;
        }
      }

      for (let attempts = 0; active && attempts < 50; attempts++) {
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
          window.location.replace(returnTo);
          return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }

      window.location.replace('/login?error=session_not_found_callback');
    };

    void finishLogin();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
