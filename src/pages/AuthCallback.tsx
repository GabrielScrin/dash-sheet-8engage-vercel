import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export default function AuthCallback() {
  useEffect(() => {
    // Com PKCE, o Supabase troca o ?code automaticamente via detectSessionInUrl.
    // Escutamos o SIGNED_IN e redirecionamos com hard reload para garantir sessão limpa.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        subscription.unsubscribe();
        window.location.replace('/app/projects');
      }
    });

    // Fallback: se sessão já está pronta antes do evento
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        subscription.unsubscribe();
        window.location.replace('/app/projects');
      }
    });

    // Timeout de segurança: 8 segundos
    const timeout = setTimeout(() => {
      subscription.unsubscribe();
      window.location.replace('/login');
    }, 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
