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
      setDetail(`URL: ${window.location.href}`);
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
        setDetail(`URL: ${window.location.href}`);
        subscription.unsubscribe();
        return;
      }
      if (session) {
        subscription.unsubscribe();
        window.location.replace('/app/projects');
      }
    });

    const timeout = setTimeout(() => {
      subscription.unsubscribe();
      const search = window.location.search;
      const hash = window.location.hash;
      const hasCode = search.includes('code=');
      const hasToken = hash.includes('access_token=');
      setError('Sessão não criada após autenticação Google.');
      setDetail(
        `search: "${search || '(vazio)'}" | hash: "${hash ? hash.slice(0, 60) + '...' : '(vazio)'}" | code=${hasCode} | token=${hasToken}`
      );
    }, 10000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-7 w-7 text-destructive" />
        </div>
        <h2 className="text-lg font-semibold">Falha na autenticação</h2>
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
