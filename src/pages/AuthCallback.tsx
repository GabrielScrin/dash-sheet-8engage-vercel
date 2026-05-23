import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const getRelevantStorageKeys = () => {
      const allKeys = [
        ...Object.keys(window.localStorage),
        ...Object.keys(window.sessionStorage),
      ];

      return allKeys.filter(key =>
        key.includes('supabase') || key.includes('pkce') || key.includes('verifier')
      );
    };

    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''));
    const urlError =
      params.get('error_description') ||
      params.get('error') ||
      hashParams.get('error_description') ||
      hashParams.get('error');

    if (urlError) {
      setError(decodeURIComponent(urlError));
      setDetail(`URL: ${window.location.href}`);
      return;
    }

    let done = false;

    const finishWithSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || done) return false;
      done = true;
      window.location.replace('/app/projects');
      return true;
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (done) return;
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        done = true;
        subscription.unsubscribe();
        window.location.replace('/app/projects');
      }
    });

    finishWithSession();

    const timeout = window.setTimeout(async () => {
      if (await finishWithSession()) {
        subscription.unsubscribe();
        return;
      }

      const storageKeys = getRelevantStorageKeys();
      setError('Sessao nao foi criada pelo callback OAuth do Supabase.');
      setDetail(
        `status: n/a | storage keys: ${storageKeys.length > 0 ? storageKeys.join(', ') : 'nenhuma'}`
      );
      subscription.unsubscribe();
    }, 8000);

    return () => {
      done = true;
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
        {detail && (
          <p className="max-w-sm break-all rounded-md bg-muted px-3 py-2 text-left font-mono text-xs text-muted-foreground">
            {detail}
          </p>
        )}
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
