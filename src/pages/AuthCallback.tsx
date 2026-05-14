import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

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

    // detectSessionInUrl:true já trocou o ?code= por sessão ao inicializar o cliente.
    // Apenas escutamos o evento resultante — sem chamar exchangeCodeForSession manualmente.
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

      // Diagnóstico: verifica o que está na URL e no localStorage
      const code = params.get('code');
      const verifierKey = Object.keys(localStorage).find(k => k.includes('code-verifier') || k.includes('pkce'));
      const hasVerifier = !!verifierKey;

      setError('Sessão não criada após autenticação Google.');
      setDetail(
        `code na URL: ${code ? code.slice(0, 16) + '...' : 'ausente'} | ` +
        `code-verifier no storage: ${hasVerifier ? `sim (${verifierKey})` : 'não encontrado'} | ` +
        `hash: ${window.location.hash ? window.location.hash.slice(0, 40) : 'vazio'}`
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
        {detail && (
          <p className="max-w-sm rounded-md bg-muted px-3 py-2 text-left font-mono text-xs text-muted-foreground break-all">
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
