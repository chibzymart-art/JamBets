/**
 * Client-Side Circuit Breaker & Resilient Storage Cache for Oddsbanta
 * Prevents Thundering Herd DDOS against Supabase during Edge hiccups or high concurrency.
 */

interface BreakerConfig {
  failureThreshold: number; // Number of consecutive failures before tripping
  coolOffMs: number;        // Time in ms to stay OPEN before attempting HALF_OPEN
  timeoutMs: number;        // Max time to wait for a database call before failing
}

class CircuitBreaker {
  private failures = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private lastStateChange = Date.now();
  private name: string;
  private config: BreakerConfig;

  constructor(name: string, config?: Partial<BreakerConfig>) {
    this.name = name;
    this.config = {
      failureThreshold: 2,
      coolOffMs: 60_000, // 60s cooldown
      timeoutMs: 4_000,  // 4s max query timeout
      ...config,
    };
  }

  public canExecute(): boolean {
    const now = Date.now();
    if (this.state === 'OPEN') {
      if (now - this.lastStateChange > this.config.coolOffMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = now;
        console.warn(`[CircuitBreaker:${this.name}] Cooldown expired. Moving to HALF_OPEN state.`);
        return true;
      }
      return false;
    }
    return true;
  }

  public recordSuccess(): void {
    if (this.state !== 'CLOSED') {
      console.log(`[CircuitBreaker:${this.name}] Operation succeeded. Resetting to CLOSED.`);
    }
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastStateChange = Date.now();
  }

  public recordFailure(err?: any): void {
    this.failures++;
    this.lastStateChange = Date.now();
    console.warn(
      `[CircuitBreaker:${this.name}] Failure recorded (${this.failures}/${this.config.failureThreshold}):`,
      err?.message || err
    );

    if (this.failures >= this.config.failureThreshold) {
      this.state = 'OPEN';
      console.error(
        `[CircuitBreaker:${this.name}] Tripped to OPEN! Shielding Supabase for ${this.config.coolOffMs / 1000}s.`
      );
    }
  }

  public getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.state;
  }

  public getTimeoutMs(): number {
    return this.config.timeoutMs;
  }
}

// Global registry of circuit breakers by service
const breakerRegistry = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, config?: Partial<BreakerConfig>): CircuitBreaker {
  let breaker = breakerRegistry.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, config);
    breakerRegistry.set(name, breaker);
  }
  return breaker;
}

/**
 * Executes an async task wrapped with a hard timeout.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Storage wrapper that safely persists feeds to sessionStorage with expiration.
 * Handles QuotaExceededError and private browsing restrictions gracefully.
 */
export const SafeStorage = {
  get<T>(key: string): T | null {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    try {
      const item = window.sessionStorage.getItem(`ob_feed_${key}`);
      if (!item) return null;
      const parsed = JSON.parse(item);
      if (parsed && typeof parsed === 'object' && 'data' in parsed && 'expiresAt' in parsed) {
        if (Date.now() > parsed.expiresAt) {
          window.sessionStorage.removeItem(`ob_feed_${key}`);
          return null;
        }
        return parsed.data as T;
      }
      return parsed as T;
    } catch {
      return null;
    }
  },

  set<T>(key: string, data: T, ttlMs = 15 * 60 * 1000): void {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      const envelope = {
        data,
        expiresAt: Date.now() + ttlMs,
        savedAt: Date.now(),
      };
      window.sessionStorage.setItem(`ob_feed_${key}`, JSON.stringify(envelope));
    } catch (e) {
      // Storage full or restricted; silently ignore to avoid application crash
      console.warn('[SafeStorage] Failed to write to sessionStorage:', e);
    }
  },

  clear(prefix?: string): void {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      if (!prefix) {
        window.sessionStorage.clear();
        return;
      }
      const p = `ob_feed_${prefix}`;
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const k = window.sessionStorage.key(i);
        if (k && k.startsWith(p)) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        window.sessionStorage.removeItem(k);
      }
    } catch {
      // Ignore
    }
  },
};
