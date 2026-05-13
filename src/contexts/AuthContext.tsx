import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGoogle: (returnTo?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  getGoogleAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event, session?.user?.email);
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        // Capture provider tokens on sign in - use UPSERT to handle missing profiles
        if (event === 'SIGNED_IN' && session?.provider_refresh_token) {
          console.log('Saving Google refresh token via upsert...');
          // Use setTimeout to avoid blocking the auth flow
          setTimeout(async () => {
            try {
              // Upsert profile (without sensitive token data)
              const { error: profileError } = await supabase
                .from('profiles')
                .upsert({
                  user_id: session.user.id,
                  email: session.user.email,
                  full_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name,
                  avatar_url: session.user.user_metadata?.avatar_url,
                }, {
                  onConflict: 'user_id',
                });

              if (profileError) {
                console.error('Failed to upsert profile:', profileError);
              }

              // Store the Google refresh token in the secure service_tokens table.
              // Delete any existing google token for this user, then insert the new one.
              await supabase
                .from('service_tokens')
                .delete()
                .eq('user_id', session.user.id)
                .eq('provider', 'google');

              const { error: tokenError } = await supabase
                .from('service_tokens')
                .insert({
                  user_id: session.user.id,
                  provider: 'google',
                  access_token: session.provider_token ?? '',
                  refresh_token: session.provider_refresh_token,
                  token_type: 'Bearer',
                  scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly',
                });

              if (tokenError) {
                console.error('Failed to store Google refresh token:', tokenError);
              } else {
                console.log('Google refresh token stored in service_tokens');
              }
            } catch (err) {
              console.error('Error upserting profile:', err);
            }
          }, 0);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async (returnTo = '/app/projects') => {
    const redirectUrl = new URL('/auth/callback', window.location.origin);
    redirectUrl.searchParams.set('next', returnTo);
    
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl.toString(),
        scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  const getGoogleAccessToken = async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.provider_token ?? null;
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
