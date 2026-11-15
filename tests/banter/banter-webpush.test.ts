// Web Push crypto: the RFC 8291 Appendix A test vector, and a VAPID signature that verifies.
import assert from 'node:assert/strict';
import { b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization } from '../../api/_lib/webpush';

console.log('banter-webpush');
let passed = 0;
const test = async (name: string, fn: () => Promise<void>) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

await test('aes128gcm encryption matches the RFC 8291 test vector byte for byte', async () => {
  const body = await encryptPayload(
    new TextEncoder().encode('When I grow up, I want to be a watermelon'),
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg',
    {
      salt: b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw'),
      localPublic: b64urlDecode('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
      localPrivateD: b64urlDecode('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
    },
  );
  assert.equal(
    b64urlEncode(body),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
});

await test('VAPID header: ES256 JWT for the push service origin that verifies with the public key', async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', {
    publicKey: b64urlEncode(pub),
    privateKey: jwk.d as string,
    subject: 'mailto:test@example.com',
  });
  const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, header);
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m![2])));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:test@example.com');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.publicKey,
    b64urlDecode(m![3]),
    new TextEncoder().encode(`${m![1]}.${m![2]}`),
  );
  assert.ok(ok, 'signature verifies');
  assert.equal(m![4], b64urlEncode(pub));
});

console.log(`banter-webpush: ${passed} passed`);
