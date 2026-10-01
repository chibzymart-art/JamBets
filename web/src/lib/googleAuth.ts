import { supabase } from './supabase';

export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '510192369088-pk636cpf0laqsfkriuuvjtfta4a03buu.apps.googleusercontent.com';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string; select_by?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            context?: 'signin' | 'signup' | 'use';
            prompt_parent_id?: string;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: 'standard' | 'icon';
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              logo_alignment?: 'left' | 'center';
              width?: number | string;
              locale?: string;
            }
          ) => void;
          prompt: (momentListener?: (notification: any) => void) => void;
          disableAutoSelect: () => void;
          revoke: (hint: string, done: () => void) => void;
        };
      };
    };
  }
}

let isInitialized = false;
type AuthSuccessCallback = (session: any) => void;
type AuthErrorCallback = (error: Error) => void;

const successListeners = new Set<AuthSuccessCallback>();
const errorListeners = new Set<AuthErrorCallback>();

export function onGoogleAuthSuccess(cb: AuthSuccessCallback) {
  successListeners.add(cb);
  return () => {
    successListeners.delete(cb);
  };
}

export function onGoogleAuthError(cb: AuthErrorCallback) {
  errorListeners.add(cb);
  return () => {
    errorListeners.delete(cb);
  };
}

/**
 * Handle Google credential (ID token) returned directly from Google Identity Services (GIS).
 * Exchanges the token via Supabase signInWithIdToken, completely bypassing the Supabase URL
 * from the browser address bar and Google consent page.
 */
export async function handleGoogleCredentialResponse(response: { credential: string }) {
  if (!response?.credential) {
    const err = new Error('No credential received from Google.');
    errorListeners.forEach((l) => l(err));
    return { data: null, error: err };
  }

  try {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: response.credential,
    });

    if (error) {
      throw error;
    }

    successListeners.forEach((l) => l(data));
    return { data, error: null };
  } catch (err: any) {
    console.error('Google ID token verification error in Supabase:', err);
    errorListeners.forEach((l) => l(err));
    return { data: null, error: err };
  }
}

/**
 * Ensure Google Identity Services is initialized on the current page with Oddsbanta branding.
 */
export function initGoogleIdentityServices(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      return resolve(false);
    }

    const setup = () => {
      if (!window.google?.accounts?.id) {
        return resolve(false);
      }

      if (!isInitialized) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
          context: 'signin',
        });
        isInitialized = true;
      }
      resolve(true);
    };

    if (window.google?.accounts?.id) {
      setup();
    } else {
      // Poll briefly for GIS script to load
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (window.google?.accounts?.id) {
          clearInterval(interval);
          setup();
        } else if (attempts > 30) {
          clearInterval(interval);
          resolve(false);
        }
      }, 100);
    }
  });
}

/**
 * Render the official Google-branded button inside a DOM element.
 * Ensures the Google prompt displays "Oddsbanta" and stays within the origin.
 */
export async function renderBrandedGoogleButton(
  container: HTMLElement | null,
  options: {
    theme?: 'outline' | 'filled_blue' | 'filled_black';
    size?: 'large' | 'medium' | 'small';
    text?: 'signin_with' | 'signup_with' | 'continue_with';
    shape?: 'rectangular' | 'pill';
    width?: number | string;
  } = {}
): Promise<boolean> {
  if (!container) return false;

  const ready = await initGoogleIdentityServices();
  if (!ready || !window.google?.accounts?.id) {
    return false;
  }

  container.innerHTML = '';
  window.google.accounts.id.renderButton(container, {
    theme: options.theme || 'filled_black',
    size: options.size || 'large',
    text: options.text || 'continue_with',
    shape: options.shape || 'pill',
    width: options.width || Math.min(360, container.offsetWidth || 320),
    logo_alignment: 'left',
  });

  return true;
}

/**
 * Display Google One Tap prompt directly on Oddsbanta.
 */
export async function promptGoogleOneTap() {
  const ready = await initGoogleIdentityServices();
  if (ready && window.google?.accounts?.id) {
    window.google.accounts.id.prompt();
  }
}

/**
 * Fallback to standard Supabase OAuth redirect flow if GIS is unavailable.
 */
export async function triggerOAuthFallback() {
  const redirectTo = `${window.location.origin}${window.location.pathname === '/' ? '/dashboard' : window.location.pathname}`;
  return await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
      },
    },
  });
}
