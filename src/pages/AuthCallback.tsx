import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

function getSafeReturnTo(value: string | null) {
  if (!value) return '/app/projects';
  if (!value.startsWith('/')) return '/app/projects';
  if (value.startsWith('//')) return '/app/projects';
  return value;
}

export default function AuthCallback() {
  useEffect(() => {
    let active = true;

    const finishLogin = async () => {
      const url = new URL(window.location.href);
      const returnTo = getSafeReturnTo(url.searchParams.get('next'));
      const code = url.searchParams.get('code');
      const errorDescription = url.searchParams.get('error_description');

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
      }

      for (let attempts = 0; active && attempts < 50; attempts++) {
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
          window.location.replace(returnTo);
          return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }

      window.location.replace('/login?error=session_not_found');
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
