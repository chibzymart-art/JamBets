// Suggests a fix for a mistyped email domain ("name@gmsil.com" -> "name@gmail.com").
// Client-side hint only: it never blocks a sign-up, it just asks the person to double-check.

const COMMON_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'mail.com', 'gmx.com', 'zoho.com', 'yandex.com',
];

const COMMON_TLDS = ['com', 'net', 'org', 'co.uk', 'ng', 'com.ng', 'me', 'io'];

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** Returns the corrected address, or null when the domain looks fine or is unknown. */
export function suggestEmailFix(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (COMMON_DOMAINS.includes(domain)) return null;

  // 1. Close to a well-known mailbox provider (gmsil.com, gmial.com, yaho.com, hotmal.com).
  let best: string | null = null;
  let bestScore = Infinity;
  for (const candidate of COMMON_DOMAINS) {
    const d = distance(domain, candidate);
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  if (best && bestScore > 0 && bestScore <= (domain.length > 6 ? 2 : 1)) return `${local}@${best}`;

  // 2. Right provider name, mistyped ending (gmail.con, yahoo.cm).
  const dot = domain.indexOf('.');
  if (dot > 0) {
    const name = domain.slice(0, dot);
    const tld = domain.slice(dot + 1);
    if (!COMMON_TLDS.includes(tld)) {
      const knownName = COMMON_DOMAINS.find((d) => d.startsWith(`${name}.`));
      if (knownName) return `${local}@${knownName}`;
    }
  }
  return null;
}
