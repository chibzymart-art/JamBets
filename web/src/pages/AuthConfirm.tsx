import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Landing page for the links in Supabase Auth emails.
//
// The email templates link here (https://www.oddsbanta.com/auth/confirm?token_hash=...&type=...)
// instead of Supabase's own /auth/v1/verify address, so every link in our email points at
// oddsbanta.com. The token is checked from the browser with verifyOtp, so a mail scanner that only
// fetches the URL does not use up the link.
//
// Password reset links are passed to /reset-password, which verifies them and shows the new
// password form. Everything else (sign-up, email change, magic link, invite) signs the user in and
// goes to the dashboard.

const ALLOWED = new Set(['signup', 'email', 'invite', 'magiclink', 'email_change', 'recovery']);

export const AuthConfirmPage: React.FC = () => {
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return; // React StrictMode runs effects twice; a token works only once
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash') || '';
    const rawType = (params.get('type') || 'email').toLowerCase();

    if (!tokenHash || !ALLOWED.has(rawType)) {
      setError('This link is incomplete. Please use the latest email we sent you.');
      return;
    }

    if (rawType === 'recovery') {
      navigate(`/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`, { replace: true });
      return;
    }

    // 'signup' is the older name for the same email confirmation.
    const type = (rawType === 'signup' ? 'email' : rawType) as 'email' | 'invite' | 'magiclink' | 'email_change';

    supabase.auth
      .verifyOtp({ token_hash: tokenHash, type })
      .then(async ({ data, error: err }) => {
        if (err) {
          // A second click on an already used sign-up link: if a session exists, just carry on.
          const { data: current } = await supabase.auth.getSession();
          if (current?.session) {
            navigate('/dashboard', { replace: true });
            return;
          }
          setError(
            /expired|invalid/i.test(err.message)
              ? 'This link has expired or was already used. Sign in, or request a new email.'
              : err.message
          );
          return;
        }
        navigate(data?.session ? '/dashboard' : '/', { replace: true });
      })
      .catch(() => setError('We could not confirm this link. Please try again.'));
  }, [navigate]);

  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        {error ? (
          <>
            <h1 style={{ fontSize: 22, marginBottom: 8 }}>Link problem</h1>
            <p style={{ marginBottom: 16 }}>{error}</p>
            <Link to="/">Back to Oddsbanta</Link>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, marginBottom: 8 }}>Confirming your email</h1>
            <p>One moment...</p>
          </>
        )}
      </div>
    </div>
  );
};

export default AuthConfirmPage;
