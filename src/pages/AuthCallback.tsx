import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const SUPABASE_STORAGE_KEY = 'sb-hzstynttwwjlhvywemml-auth-token';

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''));
    const urlError =
      params.get('error_description') ||
      params.get('error') ||
      hashParams.get('error_description') ||
      hashParams.get('error');

    if (urlError) {
      setError(decodeURIComponent(urlError));
      return;
    }

    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        subscription.unsubscribe();
        window.location.replace('/app/projects');
      }
    });

    const finishSession = async () => {
      if (accessToken && refreshToken) {
        try {
          const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            method: 'GET',
            headers: {
              apikey: SUPABASE_PUBLISHABLE_KEY,
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (!userResponse.ok) {
            const body = await userResponse.text();
            setError(`Falha ao buscar usuario da sessao: ${userResponse.status} ${body}`);
            subscription.unsubscribe();
            return;
          }

          const user = await userResponse.json();
          const expiresAt = Number(hashParams.get('expires_at') || 0);
          const expiresIn = Number(hashParams.get('expires_in') || 0);
          const providerToken = hashParams.get('provider_token');
          const providerRefreshToken = hashParams.get('provider_refresh_token');
          const tokenType = hashParams.get('token_type') || 'bearer';

          const session = {
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: expiresAt,
            expires_in: expiresIn,
            token_type: tokenType,
            provider_token: providerToken,
            provider_refresh_token: providerRefreshToken,
            user,
          };

          window.localStorage.setItem(SUPABASE_STORAGE_KEY, JSON.stringify(session));
          subscription.unsubscribe();
          window.history.replaceState({}, document.title, '/auth/callback');
          window.location.replace('/app/projects');
          return;
        } catch (manualSessionError) {
          setError(
            manualSessionError instanceof Error
              ? manualSessionError.message
              : 'Falha ao persistir a sessao manualmente.'
          );
          subscription.unsubscribe();
          return;
        }
      }

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        setError(sessionError.message);
        subscription.unsubscribe();
        return;
      }

      if (session) {
        subscription.unsubscribe();
        window.location.replace('/app/projects');
      }
    };

    void finishSession();

    const timeout = window.setTimeout(() => {
      subscription.unsubscribe();
      setError(
        accessToken && refreshToken
          ? 'Os tokens voltaram do Supabase, mas a sessao nao foi persistida no navegador.'
          : 'Sessao nao criada. O Google autenticou mas o Supabase nao devolveu tokens para o app.'
      );
    }, 10000);

    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-7 w-7 text-destructive" />
        </div>
        <h2 className="text-lg font-semibold">Falha na autenticacao</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
        <a
          href="/login"
          className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Voltar ao login
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Autenticando...</p>
    </div>
  );
}
