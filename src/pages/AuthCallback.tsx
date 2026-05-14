import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const getRelevantCookieKeys = () =>
      document.cookie
        .split('; ')
        .map(cookie => cookie.split('=')[0])
        .filter(key => key.includes('supabase') || key.includes('pkce') || key.includes('verifier'));

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
      setError('Nenhum codigo de autenticacao recebido na URL.');
      setDetail(`URL: ${window.location.href}`);
      return;
    }

    // detectSessionInUrl fica desativado para nao consumir o verifier antes daqui.
    // A SDK espera apenas o auth code; o verifier fica persistido no storage.
    supabase.auth.exchangeCodeForSession(code).then(({ data, error: exchangeError }) => {
      if (exchangeError) {
        const cookieKeys = getRelevantCookieKeys();
        setError(`Falha na troca do codigo: ${exchangeError.message}`);
        setDetail(
          `status: ${exchangeError.status ?? 'n/a'} | ` +
          `cookie keys: ${cookieKeys.length > 0 ? cookieKeys.join(', ') : 'nenhuma'}`
        );
        return;
      }

      if (data?.session) {
        window.location.replace('/app/projects');
      } else {
        setError('Troca realizada mas sessao nao foi retornada.');
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
