import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

const SUPABASE_STORAGE_KEY = 'sb-hzstynttwwjlhvywemml-auth-token';

function parseJwtPayload(token: string) {
  const [, payload] = token.split('.');
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

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

    if (accessToken && refreshToken) {
      try {
        const payload = parseJwtPayload(accessToken);
        const expiresAt = Number(hashParams.get('expires_at') || payload.exp || 0);
        const expiresIn = Number(hashParams.get('expires_in') || Math.max(expiresAt - Math.floor(Date.now() / 1000), 0));
        const providerToken = hashParams.get('provider_token');
        const providerRefreshToken = hashParams.get('provider_refresh_token');
        const tokenType = hashParams.get('token_type') || 'bearer';
        const nowIso = new Date().toISOString();

        const user = {
          id: payload.sub,
          aud: payload.aud,
          role: payload.role,
          email: payload.email,
          phone: payload.phone || '',
          app_metadata: payload.app_metadata || {},
          user_metadata: payload.user_metadata || {},
          identities: [],
          factors: null,
          created_at: nowIso,
          updated_at: nowIso,
          is_anonymous: payload.is_anonymous || false,
        };

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

        const serializedSession = JSON.stringify(session);
        window.localStorage.setItem(SUPABASE_STORAGE_KEY, serializedSession);

        if (window.localStorage.getItem(SUPABASE_STORAGE_KEY) !== serializedSession) {
          throw new Error('O navegador recusou gravar a sessao no localStorage.');
        }

        window.history.replaceState({}, document.title, '/auth/callback');
        const returnTo = window.localStorage.getItem('auth_return_to');
        window.localStorage.removeItem('auth_return_to');
        window.location.assign(returnTo || '/app/projects');
      } catch (manualSessionError) {
        setError(
          manualSessionError instanceof Error
            ? manualSessionError.message
            : 'Falha ao persistir a sessao manualmente.'
        );
      }
      return;
    }

    setError('Sessao nao criada. O Google autenticou mas o Supabase nao devolveu tokens para o app.');
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
