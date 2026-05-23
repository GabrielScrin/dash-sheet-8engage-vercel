import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        subscription.unsubscribe();
        window.location.replace('/app/projects');
      }
    });

    supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (sessionError) {
        setError(sessionError.message);
        subscription.unsubscribe();
        return;
      }

      if (session) {
        subscription.unsubscribe();
        window.location.replace('/app/projects');
      }
    });

    const timeout = window.setTimeout(() => {
      subscription.unsubscribe();
      setError(
        'Sessao nao criada. O Google autenticou mas o Supabase nao recebeu os tokens. ' +
        'Verifique se o Client Secret do Google esta configurado em Authentication > Providers > Google no Supabase.'
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
