import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

function getSafeReturnTo(value: string | null) {
  if (!value) return '/app/projects';
  if (!value.startsWith('/')) return '/app/projects';
  if (value.startsWith('//')) return '/app/projects';
  return value;
}

export default function AuthCallback() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;

    const url = new URL(window.location.href);
    const returnTo = getSafeReturnTo(url.searchParams.get('next'));
    const errorDescription = url.searchParams.get('error_description');

    if (errorDescription) {
      window.location.replace(`/login?error=${encodeURIComponent(errorDescription)}`);
      return;
    }

    if (user) {
      navigate(returnTo, { replace: true });
      return;
    }

    window.location.replace('/login?error=session_not_found_callback');
  }, [loading, navigate, user]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
