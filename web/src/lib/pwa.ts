/**
 * "Install as app" support.
 *
 * - registerAppServiceWorker(): registers /sw.js (production only). That worker only shows an offline
 *   screen when a page can't load; it never caches feeds, predictions or auth (see public/sw.js).
 * - The browser's install event (Android Chrome, Edge, Samsung Internet) fires early, often before
 *   React has drawn anything, so it is captured here at startup and handed to the install prompt.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export const INSTALLED_KEY = 'oddsbanta_app_installed_v1';

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function clearDeferredInstallPrompt(): void {
  deferredPrompt = null;
  notify();
}

export function onInstallPromptChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
}

export function initInstallCapture(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Hold the browser's own mini-bar back; our prompt offers the same install at a better moment.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    try { localStorage.setItem(INSTALLED_KEY, new Date().toISOString()); } catch { /* storage blocked */ }
    deferredPrompt = null;
    notify();
  });
}

export function registerAppServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* No offline screen on this device; the site works exactly as before. */
    });
  };
  // Wait until the page has finished loading so the worker never competes with the first paint.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
