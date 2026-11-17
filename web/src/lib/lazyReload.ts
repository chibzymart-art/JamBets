import { lazy, type ComponentType } from 'react';

/**
 * React.lazy that survives a new deploy. If a page's file can't be loaded (the browser still runs the
 * previous version of the site and asks for a file the new deploy no longer has), reload the page
 * once so the browser picks up the new version. A flag in sessionStorage stops a reload loop; it is
 * cleared after a successful load so the next deploy is handled too.
 */
export function lazyWithReload<T extends ComponentType<any>>(key: string, load: () => Promise<{ default: T }>) {
  const flag = `oddsbanta_chunk_reload_${key}`;
  return lazy(async () => {
    try {
      const mod = await load();
      try { sessionStorage.removeItem(flag); } catch { /* storage blocked */ }
      return mod;
    } catch (err) {
      let already = true;
      try { already = sessionStorage.getItem(flag) === '1'; } catch { /* storage blocked */ }
      if (!already) {
        try { sessionStorage.setItem(flag, '1'); } catch { /* storage blocked */ }
        window.location.reload();
        // Keep Suspense showing its fallback while the page reloads.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
