import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export default function AuthCallback() {
  useEffect(() => {
    let attempts = 0;
    const max = 50; // 5 segundos

    const poll = setInterval(async () => {
      attempts++;
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        clearInterval(poll);
        window.location.replace('/app/projects');
        return;
      }

      if (attempts >= max) {
        clearInterval(poll);
        window.location.replace('/login');
      }
    }, 100);

    return () => clearInterval(poll);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
