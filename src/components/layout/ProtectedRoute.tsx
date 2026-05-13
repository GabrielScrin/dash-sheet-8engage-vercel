import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [oauthLoading, setOauthLoading] = useState(false);
  const hasOAuthParams =
    location.search.includes('code=') ||
    location.search.includes('error_description=') ||
    location.hash.includes('access_token=') ||
    location.hash.includes('refresh_token=');

  useEffect(() => {
    if (!hasOAuthParams) return;

    let active = true;

    const finishOAuth = async () => {
      setOauthLoading(true);

      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        const errorDescription = url.searchParams.get('error_description');
        const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (errorDescription) {
          window.location.replace(`/login?error=${encodeURIComponent(errorDescription)}`);
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            window.location.replace(`/login?error=${encodeURIComponent(error.message)}`);
            return;
          }
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            window.location.replace(`/login?error=${encodeURIComponent(error.message)}`);
            return;
          }
        }

        if (!active) return;

        window.history.replaceState({}, document.title, location.pathname);
      } finally {
        if (active) {
          setOauthLoading(false);
        }
      }
    };

    void finishOAuth();

    return () => {
      active = false;
    };
  }, [hasOAuthParams, location.pathname]);

  if (loading || oauthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
