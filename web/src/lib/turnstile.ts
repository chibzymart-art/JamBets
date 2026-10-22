// Cloudflare Turnstile for the auth forms (sign-up, sign-in, password reset, Google sign-in).
//
// Supabase Auth checks the token when CAPTCHA protection is on (Authentication > Attack Protection).
// getCaptchaToken() loads Turnstile on first use, runs one challenge and resolves with a single-use
// token. Most visitors pass invisibly; if Cloudflare wants an interaction, a small panel appears at the
// bottom of the screen until it is done.
//
// The site key is public (it ships in every page that uses Turnstile). The secret key lives only in
// Supabase.

const SITE_KEY: string =
  (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAAFg_hLChpnRASIxg';

// Turnstile only accepts hostnames registered on the widget. Elsewhere (local dev, preview URLs)
// no token is requested, and Supabase will refuse the auth call only if CAPTCHA is on there too.
const ALLOWED_HOSTS = new Set(['oddsbanta.com', 'www.oddsbanta.com', 'jam-bets-neon.vercel.app']);

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      execute: (id: string) => void;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load the security check. Check your connection and try again.'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

function host(): HTMLElement {
  let el = document.getElementById('ob-turnstile-host');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ob-turnstile-host';
    el.setAttribute('aria-live', 'polite');
    el.style.cssText =
      'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;';
    document.body.appendChild(el);
  }
  return el;
}

export function captchaEnabledHere(): boolean {
  return typeof window !== 'undefined' && !!SITE_KEY && ALLOWED_HOSTS.has(window.location.hostname);
}

/**
 * Returns a fresh single-use Turnstile token, or undefined where CAPTCHA does not apply
 * (local dev, preview hosts). Rejects if the check fails or times out.
 */
export async function getCaptchaToken(timeoutMs = 60000): Promise<string | undefined> {
  if (!captchaEnabledHere()) return undefined;
  await loadScript();
  const ts = window.turnstile;
  if (!ts) throw new Error('Security check unavailable. Please refresh the page and try again.');

  const container = document.createElement('div');
  host().appendChild(container);

  return new Promise<string>((resolve, reject) => {
    let widgetId = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (widgetId) ts.remove(widgetId); } catch { /* already gone */ }
      container.remove();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('The security check timed out. Please try again.'))),
      timeoutMs
    );
    try {
      widgetId = ts.render(container, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        execution: 'render',
        action: 'auth',
        callback: (token: string) => finish(() => resolve(token)),
        'error-callback': () =>
          finish(() => reject(new Error('The security check failed. Please refresh and try again.'))),
        'expired-callback': () =>
          finish(() => reject(new Error('The security check expired. Please try again.'))),
      });
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error('Security check error.')));
    }
  });
}

/**
 * Like getCaptchaToken, but never throws: if the check cannot run (blocked script, timeout), the auth
 * call goes ahead without a token and Supabase decides. That keeps sign-in working whenever CAPTCHA is
 * switched off, and gives a clear Supabase error when it is on.
 */
export async function tryCaptchaToken(): Promise<string | undefined> {
  try {
    return await getCaptchaToken();
  } catch (err) {
    console.warn('[turnstile]', err instanceof Error ? err.message : err);
    return undefined;
  }
}

/** Friendly text for Supabase's CAPTCHA rejection. */
export function captchaErrorMessage(msg: string): string | null {
  return /captcha/i.test(msg || '')
    ? 'The security check did not complete. Please refresh the page and try again.'
    : null;
}
