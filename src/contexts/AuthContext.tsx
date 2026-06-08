import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_STORAGE_KEY = 'sb-hzstynttwwjlhvywemml-auth-token';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  getGoogleAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const bootstrapSession = (): Session | null => {
      try {
        const rawSession = window.localStorage.getItem(SUPABASE_STORAGE_KEY);
        if (!rawSession) return null;

        const parsedSession = JSON.parse(rawSession) as Session;
        setSession(parsedSession);
        setUser(parsedSession.user ?? null);
        return parsedSession;
      } catch (error) {
        console.error('Error restoring session from storage:', error);
        window.localStorage.removeItem(SUPABASE_STORAGE_KEY);
        return null;
      } finally {
        setLoading(false);
      }
    };

    const restoredSession = bootstrapSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'INITIAL_SESSION' && !session && restoredSession) {
          setLoading(false);
          return;
        }

        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        if (event === 'SIGNED_IN' && session?.provider_refresh_token) {
          setTimeout(async () => {
            try {
              await supabase.from('profiles').upsert({
                user_id: session.user.id,
                email: session.user.email,
                full_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name,
                avatar_url: session.user.user_metadata?.avatar_url,
              }, { onConflict: 'user_id' });

              await supabase.from('service_tokens').delete()
                .eq('user_id', session.user.id).eq('provider', 'google');

              await supabase.from('service_tokens').insert({
                user_id: session.user.id,
                provider: 'google',
                access_token: session.provider_token ?? '',
                refresh_token: session.provider_refresh_token,
                token_type: 'Bearer',
                scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly',
              });
            } catch (err) {
              console.error('Error saving tokens:', err);
            }
          }, 0);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly',
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account consent',
        },
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.localStorage.removeItem(SUPABASE_STORAGE_KEY);
    setUser(null);
    setSession(null);
  };

  const getGoogleAccessToken = async (): Promise<string | null> => {
    return session?.provider_token ?? null;
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signInWithGoogle, signOut, getGoogleAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
