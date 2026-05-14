import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Shield, Zap, Table2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { supabase } from '@/integrations/supabase/client';

declare global {
  interface Window {
    google?: any;
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

async function generateNoncePair() {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const encodedNonce = new TextEncoder().encode(nonce);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encodedNonce);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashedNonce = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return { nonce, hashedNonce };
}

export default function Login() {
  const { user, loading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  const from = (() => {
    const state = location.state as any;
    const rawFrom = state?.from;

    if (typeof rawFrom === 'string') return rawFrom;
    if (rawFrom?.pathname) return `${rawFrom.pathname}${rawFrom.search || ''}`;

    return '/app/projects';
  })();

  useEffect(() => {
    if (user && !loading) {
      navigate(from, { replace: true });
    }
  }, [user, loading, navigate, from]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const error = params.get('error');

    if (!error) return;

    const description =
      error === 'session_not_found'
        ? 'O Google autenticou, mas o Supabase nao criou a sessao do app. Verifique as Redirect URLs do Supabase para este dominio.'
        : error === 'session_not_found_callback'
          ? 'O callback voltou sem sessao ativa. Isso indica falha no retorno OAuth do Supabase ou no formato do token recebido.'
        : decodeURIComponent(error);

    toast({
      title: 'Falha no login',
      description,
      variant: 'destructive',
    });
  }, [location.search, toast]);

  useEffect(() => {
    let cancelled = false;

    const renderGoogleButton = async () => {
      if (!googleButtonRef.current || loading || user) return;

      const loadScript = () =>
        new Promise<void>((resolve, reject) => {
          if (window.google?.accounts?.id) {
            resolve();
            return;
          }

          const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
          if (existingScript) {
            existingScript.addEventListener('load', () => resolve(), { once: true });
            existingScript.addEventListener('error', () => reject(new Error('Falha ao carregar Google Identity Services.')), { once: true });
            return;
          }

          const script = document.createElement('script');
          script.src = 'https://accounts.google.com/gsi/client';
          script.async = true;
          script.defer = true;
          script.dataset.googleIdentity = 'true';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Falha ao carregar Google Identity Services.'));
          document.head.appendChild(script);
        });

      try {
        if (!GOOGLE_CLIENT_ID) {
          throw new Error('VITE_GOOGLE_CLIENT_ID nao configurado.');
        }

        await loadScript();
        if (cancelled || !googleButtonRef.current || !window.google?.accounts?.id) return;

        const { nonce, hashedNonce } = await generateNoncePair();
        if (cancelled || !googleButtonRef.current) return;

        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: hashedNonce,
          use_fedcm_for_prompt: true,
          callback: async (response: { credential?: string }) => {
            if (!response.credential) {
              toast({
                title: 'Erro ao fazer login',
                description: 'Google nao retornou um token valido.',
                variant: 'destructive',
              });
              return;
            }

            setIsLoading(true);

            const { error } = await supabase.auth.signInWithIdToken({
              provider: 'google',
              token: response.credential,
              nonce,
            });

            if (error) {
              toast({
                title: 'Erro ao fazer login',
                description: error.message,
                variant: 'destructive',
              });
              setIsLoading(false);
              return;
            }

            navigate(from, { replace: true });
          },
        });

        googleButtonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'signin_with',
          width: 396,
          logo_alignment: 'left',
        });
      } catch (error: any) {
        toast({
          title: 'Erro ao preparar login Google',
          description: error.message,
          variant: 'destructive',
        });
      }
    };

    void renderGoogleButton();

    return () => {
      cancelled = true;
    };
  }, [from, loading, navigate, toast, user]);

  const features = [
    {
      icon: Table2,
      title: 'Conexão Direta',
      description: 'Conecte suas planilhas Google sem intermediários',
    },
    {
      icon: Zap,
      title: 'Dashboards Instantâneos',
      description: 'Configure e compartilhe em minutos',
    },
    {
      icon: Shield,
      title: '100% Seguro',
      description: 'Acesso somente leitura às suas planilhas',
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="absolute top-0 right-0 p-4">
        <ThemeToggle />
      </header>

      <div className="container flex min-h-screen flex-col items-center justify-center py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          {/* Logo */}
          <div className="mb-8 flex flex-col items-center text-center">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 shadow-lg"
            >
              <img src="/cr8-logo.svg" alt="CR8 Logo" className="h-9 w-9 object-contain" />
            </motion.div>
            <h1 className="text-3xl font-bold tracking-tight">Engage DashView</h1>
            <p className="mt-2 text-muted-foreground">
              Dashboards inteligentes para suas planilhas
            </p>
          </div>

          {/* Login Card */}
          <Card className="border-2 shadow-xl">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Bem-vindo de volta</CardTitle>
              <CardDescription>
                Entre com sua conta Google para acessar seus dashboards
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="flex h-12 items-center justify-center rounded-md border">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="h-5 w-5 border-2 border-current border-t-transparent rounded-full"
                  />
                </div>
              ) : (
                <div className="flex justify-center">
                  <div ref={googleButtonRef} />
                </div>
              )}

              <p className="text-center text-xs text-muted-foreground">
                Ao continuar, você concorda com nossos{' '}
                <a href="#" className="underline hover:text-primary">
                  Termos de Serviço
                </a>{' '}
                e{' '}
                <a href="#" className="underline hover:text-primary">
                  Política de Privacidade
                </a>
              </p>
            </CardContent>
          </Card>

          {/* Features */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="mt-8 grid grid-cols-3 gap-4"
          >
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + index * 0.1 }}
                className="flex flex-col items-center text-center"
              >
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-medium">{feature.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
