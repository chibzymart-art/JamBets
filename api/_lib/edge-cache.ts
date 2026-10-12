// Stale-While-Revalidate (SWR) Edge In-Memory Cache for Oddsbanta
// Protects Supabase Free Tier from Connection Exhaustion & Egress Limits
// Enhanced for Sub-Phase 2.4: Real-Time Dynamic Snapshot Invalidation

export interface EdgeCacheEntry<T> {
  data: T;
  freshUntil: number;
  staleUntil: number;
  cachedAt: number;
}

export class EdgeSwrCache<T> {
  private cache = new Map<string, EdgeCacheEntry<T>>();
  private inflight = new Map<string, Promise<T>>();

  constructor(
    private freshMs: number = 300 * 1000, // Default 5 minutes fresh
    private staleMs: number = 3600 * 1000  // 1 hour allowable stale
  ) {}

  /**
   * Get cached data if fresh or stale.
   * If ttlOrCalculator is provided (number or function computing TTL from data), overrides default fresh duration.
   * If stale, returns cached data immediately (< 0.05ms) and triggers background revalidation.
   * If cold or past stale window, fetches upstream with thundering-herd deduplication.
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<T>,
    ttlOrCalculator?: number | ((data: T) => number)
  ): Promise<{ data: T; isStale: boolean }> {
    const now = Date.now();
    const entry = this.cache.get(key);

    if (entry) {
      if (now < entry.freshUntil) {
        // Tier 1: Fresh cache (< 0.01ms)
        return { data: entry.data, isStale: false };
      }

      if (now < entry.staleUntil) {
        // Tier 2: Stale-While-Revalidate: Return immediately, revalidate in background
        this.revalidateInBackground(key, fetcher, ttlOrCalculator);
        return { data: entry.data, isStale: true };
      }
    }

    // Tier 3: Cold start or expired past stale window -> fetch with promise deduplication
    let promise = this.inflight.get(key);
    if (!promise) {
      promise = fetcher()
        .then((data) => {
          const freshDuration = typeof ttlOrCalculator === 'function' ? ttlOrCalculator(data) : ttlOrCalculator;
          this.set(key, data, freshDuration);
          this.inflight.delete(key);
          return data;
        })
        .catch((err) => {
          this.inflight.delete(key);
          // If upstream fails (e.g. Supabase connection pool exhaustion) but we have older data, serve it!
          if (entry) {
            console.warn(`Upstream fetch failed for ${key}, falling back to stale cache:`, err.message || err);
            return entry.data;
          }
          throw err;
        });
      this.inflight.set(key, promise);
    }

    const data = await promise;
    return { data, isStale: false };
  }

  set(key: string, data: T, customFreshMs?: number) {
    const now = Date.now();
    const freshDuration = typeof customFreshMs === 'number' && customFreshMs > 0 ? customFreshMs : this.freshMs;
    this.cache.set(key, {
      data,
      freshUntil: now + freshDuration,
      staleUntil: now + this.staleMs,
      cachedAt: now,
    });
  }

  get(key: string): T | null {
    return this.cache.get(key)?.data || null;
  }

  getEntry(key: string): EdgeCacheEntry<T> | null {
    return this.cache.get(key) || null;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  isFresh(key: string): boolean {
    const entry = this.cache.get(key);
    return Boolean(entry && Date.now() < entry.freshUntil);
  }

  /**
   * Invalidates a specific key or all keys in this cache.
   */
  invalidate(key?: string) {
    if (key) {
      this.cache.delete(key);
      this.inflight.delete(key);
    } else {
      this.clear();
    }
  }

  clear() {
    this.cache.clear();
    this.inflight.clear();
  }

  size(): number {
    return this.cache.size;
  }

  private revalidateInBackground(key: string, fetcher: () => Promise<T>, ttlOrCalculator?: number | ((data: T) => number)) {
    if (this.inflight.has(key)) return;
    const promise = fetcher()
      .then((data) => {
        const freshDuration = typeof ttlOrCalculator === 'function' ? ttlOrCalculator(data) : ttlOrCalculator;
        this.set(key, data, freshDuration);
        this.inflight.delete(key);
        return data;
      })
      .catch((err) => {
        this.inflight.delete(key);
        console.warn(`Background revalidation failed for ${key}:`, err.message || err);
      });
    this.inflight.set(key, promise);
  }
}

/**
 * Global Edge Cache Registry for on-demand invalidation across Edge functions.
 * Allows webhooks or admin requests to dynamically bust SWR caches in memory.
 */
export class EdgeCacheRegistry {
  private static caches = new Map<string, EdgeSwrCache<any>>();

  static register(name: string, cache: EdgeSwrCache<any>) {
    this.caches.set(name, cache);
  }

  static get(name: string): EdgeSwrCache<any> | undefined {
    return this.caches.get(name);
  }

  static invalidate(nameOrKey?: string): string[] {
    const invalidated: string[] = [];
    if (nameOrKey && this.caches.has(nameOrKey)) {
      this.caches.get(nameOrKey)?.clear();
      invalidated.push(nameOrKey);
    } else {
      for (const [name, cache] of this.caches.entries()) {
        cache.clear();
        invalidated.push(name);
      }
    }
    return invalidated;
  }

  static stats(): Record<string, { size: number }> {
    const result: Record<string, { size: number }> = {};
    for (const [name, cache] of this.caches.entries()) {
      result[name] = { size: cache.size() };
    }
    return result;
  }
}

