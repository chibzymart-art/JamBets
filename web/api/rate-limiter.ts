// Vercel Edge Runtime Sliding-Window In-Memory Rate Limiter

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const ipStore = new Map<string, RateLimitRecord>();

let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup > windowMs * 2) {
    lastCleanup = now;
    for (const [key, record] of ipStore.entries()) {
      if (now > record.resetAt) {
        ipStore.delete(key);
      }
    }
  }
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number
): { allowed: boolean; remaining: number; resetSec: number } {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  cleanup(windowMs);

  const record = ipStore.get(key);
  if (!record || now > record.resetAt) {
    ipStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetSec: windowSec };
  }

  if (record.count >= limit) {
    const resetSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return { allowed: false, remaining: 0, resetSec };
  }

  record.count += 1;
  const resetSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
  return { allowed: true, remaining: limit - record.count, resetSec };
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') || 'unknown';
}
