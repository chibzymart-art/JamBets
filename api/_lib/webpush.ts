// Web Push for the Banter Hub, with no npm dependency (the root api/ has no package.json).
// Implements VAPID (RFC 8292, ES256 JWT) and message encryption (RFC 8291, aes128gcm / RFC 8188)
// with the Web Crypto API, so it runs on the Vercel Edge runtime and in Node 18+.
//
// Keys: VAPID_PUBLIC_KEY is the uncompressed P-256 public key (65 bytes), VAPID_PRIVATE_KEY is the
// private scalar d (32 bytes), both base64url without padding (the format the web-push package uses).

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string; // mailto: or https: contact for the push services
}

/** Bytes backed by a plain ArrayBuffer (what Web Crypto accepts). */
type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

export function b64urlEncode(bytes: Bytes): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Bytes {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, data));
}

/** HKDF-SHA256 with a single output block (length <= 32). */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

function publicJwk(publicKey: Bytes): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error('bad_public_key');
  return { kty: 'EC', crv: 'P-256', x: b64urlEncode(publicKey.slice(1, 33)), y: b64urlEncode(publicKey.slice(33, 65)), ext: true };
}

/**
 * RFC 8291 encryption. `salt` and `localKeys` are only passed by tests (the RFC test vector);
 * normally they are random per message.
 */
export async function encryptPayload(
  payload: Bytes,
  uaPublicB64: string,
  authSecretB64: string,
  testing?: { salt: Bytes; localPublic: Bytes; localPrivateD: Bytes },
): Promise<Bytes> {
  const uaPublic = b64urlDecode(uaPublicB64);
  const authSecret = b64urlDecode(authSecretB64);

  let localPrivate: CryptoKey;
  let localPublic: Bytes;
  if (testing) {
    localPublic = testing.localPublic;
    localPrivate = await subtle().importKey(
      'jwk',
      { ...publicJwk(localPublic), d: b64urlEncode(testing.localPrivateD) },
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
  } else {
    const pair = (await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    localPrivate = pair.privateKey;
    localPublic = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  }

  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, localPrivate, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, localPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = testing ? testing.salt : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const plaintext = concat(payload, new Uint8Array([2])); // single record, last-record delimiter
  const aesKey = await subtle().importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + localPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = localPublic.length;
  header.set(localPublic, 21);
  return concat(header, ciphertext);
}

/** VAPID Authorization header value for one push service origin. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, expSeconds = 12 * 3600): Promise<string> {
  const aud = new URL(endpoint).origin;
  const publicKey = b64urlDecode(keys.publicKey);
  const jwk = { ...publicJwk(publicKey), d: keys.privateKey };
  const signer = await subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + expSeconds, sub: keys.subject })));
  const unsigned = `${header}.${claims}`;
  const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

export type SendResult = { endpoint: string; ok: boolean; gone: boolean; status: number };

/** Encrypt and send one notification. gone = the push service says this subscription is dead. */
export async function sendWebPush(
  sub: PushSubscriptionKeys,
  data: unknown,
  keys: VapidKeys,
  { ttl = 86400, urgency = 'normal' }: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' } = {},
): Promise<SendResult> {
  try {
    const body = await encryptPayload(enc.encode(JSON.stringify(data)), sub.p256dh, sub.auth);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, keys),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
      },
      body,
    });
    return { endpoint: sub.endpoint, ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch {
    return { endpoint: sub.endpoint, ok: false, gone: false, status: 0 };
  }
}
