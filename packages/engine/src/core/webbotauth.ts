/**
 * Honest agent identity: Web Bot Auth (HTTP Message Signatures, RFC 9421, Ed25519) so sites and CDNs
 * (Cloudflare "signed agents") can verify that requests come from this agent instead of guessing.
 * We sign; we never spoof fingerprints or solve CAPTCHAs.
 *
 *   Signature-Agent: "https://agent.example"
 *   Signature-Input: sig1=("@authority" "signature-agent");created=..;expires=..;keyid="<jwk thumbprint>";alg="ed25519";nonce="..";tag="web-bot-auth"
 *   Signature: sig1=:<base64>:
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

export interface BotAuthKey {
  privateKey: KeyObject;
  /** RFC 7638 JWK thumbprint (base64url), used as keyid. */
  keyid: string;
  jwk: { kty: 'OKP'; crv: 'Ed25519'; x: string };
}

export function generateBotKey(): { key: BotAuthKey; pem: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  return { key: keyFromPrivate(privateKey), pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}

export function loadBotKey(pem: string): BotAuthKey {
  return keyFromPrivate(createPrivateKey(pem));
}

function keyFromPrivate(privateKey: KeyObject): BotAuthKey {
  const pub = createPublicKey(privateKey).export({ format: 'jwk' }) as { x: string };
  const jwk = { kty: 'OKP' as const, crv: 'Ed25519' as const, x: pub.x };
  const thumb = createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${jwk.x}"}`).digest('base64url');
  return { privateKey, keyid: thumb, jwk };
}

/** Headers to add to a request to `url`. `agentUrl` hosts /.well-known/http-message-signatures-directory. */
export function signRequest(url: string, key: BotAuthKey, agentUrl: string, ttlSec = 60, now = Math.floor(Date.now() / 1000)): Record<string, string> {
  const authority = new URL(url).host.toLowerCase();
  const sigAgent = `"${agentUrl}"`;
  const params = `("@authority" "signature-agent");created=${now};expires=${now + ttlSec};keyid="${key.keyid}";alg="ed25519";nonce="${randomBytes(32).toString('base64')}";tag="web-bot-auth"`;
  const base = `"@authority": ${authority}\n"signature-agent": ${sigAgent}\n"@signature-params": ${params}`;
  const sig = sign(null, Buffer.from(base), key.privateKey).toString('base64');
  return { 'Signature-Agent': sigAgent, 'Signature-Input': `sig1=${params}`, Signature: `sig1=:${sig}:` };
}

/** The key directory to serve at <agentUrl>/.well-known/http-message-signatures-directory. */
export function keyDirectory(key: BotAuthKey): { keys: BotAuthKey['jwk'][] } {
  return { keys: [key.jwk] };
}
