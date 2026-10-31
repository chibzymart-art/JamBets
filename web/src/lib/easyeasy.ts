/**
 * EasyEasy promoter conversion reporting.
 *
 * The pixel (loaded async in index.html) captures a promoter click id from the landing URL
 * (ee_click_id / subid / ee_subid / click_id) into localStorage + a 30-day cookie.
 * Here we only report a conversion when a click id exists, so organic users are never sent to EasyEasy.
 * Every call is fire-and-forget: if the pixel is blocked or EasyEasy is down, nothing on Oddsbanta changes.
 */

interface EasyEasyApi {
  initialized?: boolean;
  track?: (event: string, data?: Record<string, unknown>) => Promise<unknown>;
  getClickId?: () => string | null;
}

function api(): EasyEasyApi | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { EasyEasy?: EasyEasyApi }).EasyEasy) || null;
}

/** Promoter click id held by the pixel in this browser, if any. */
export function getEasyEasyClickId(): string | null {
  try {
    const fromPixel = api()?.getClickId?.();
    if (fromPixel) return String(fromPixel).slice(0, 200);
    const stored = window.localStorage.getItem('ee_click_id');
    return stored ? stored.slice(0, 200) : null;
  } catch {
    return null;
  }
}

/**
 * Report a completed registration once per account (order_id = the account id, so retries are de-duplicated
 * by EasyEasy too). `metadataClickId` comes from the account itself, set at sign-up, so a user who confirms
 * their email on another device is still attributed.
 */
export function reportEasyEasySignup(userId: string, metadataClickId?: unknown): void {
  try {
    if (!userId) return;
    const clickId = getEasyEasyClickId() || (typeof metadataClickId === 'string' ? metadataClickId.slice(0, 200) : null);
    if (!clickId) return; // not referred by a promoter: report nothing
    const doneKey = `ob_ee_signup_${userId}`;
    if (window.localStorage.getItem(doneKey) === '1') return;

    const send = (): boolean => {
      const ee = api();
      if (!ee?.track) return false;
      window.localStorage.setItem(doneKey, '1');
      ee.track('signup', { order_id: userId, subid: clickId }).catch(() => null);
      return true;
    };
    // The pixel loads async; give it a few seconds if it is not ready yet.
    if (!send()) {
      let tries = 0;
      const timer = window.setInterval(() => {
        tries += 1;
        if (send() || tries >= 10) window.clearInterval(timer);
      }, 1000);
    }
  } catch {
    /* tracking must never affect sign-in */
  }
}
