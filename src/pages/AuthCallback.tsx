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

    const code = params.get('code');

    if (!code) {
      setError('Nenhum código de autenticação recebido na URL.');
      setDetail(`URL: ${window.location.href}`);
      return;
    }

    // detectSessionInUrl está desativado para não consumir o verifier antes de nós.
    // Fazemos a troca manualmente com captura de erro.
    supabase.auth.exchangeCodeForSession(window.location.href).then(({ data, error: exchangeError }) => {
      if (exchangeError) {
        const storageKeys = Object.keys(localStorage).filter(k =>
          k.includes('supabase') || k.includes('pkce') || k.includes('verifier')
        );
        setError(`Falha na troca do código: ${exchangeError.message}`);
        setDetail(
          `status: ${exchangeError.status ?? 'n/a'} | ` +
          `storage keys: ${storageKeys.length > 0 ? storageKeys.join(', ') : 'nenhuma'}`
        );
        return;
      }

      if (data?.session) {
        window.location.replace('/app/projects');
      } else {
        setError('Troca realizada mas sessão não foi retornada.');
        setDetail(`URL: ${window.location.href}`);
      }
    });
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
