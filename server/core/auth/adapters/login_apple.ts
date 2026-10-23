/** The real adapter `login-apple`: Apple identity token checks, the refresh token exchange and its revoke. */
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import type { HttpAdapter, KeySource } from '../deps.ts';
import { JwksCache, ok, parse_apple_credential, post_form, rejected, verify_id_token, type AppleAdapter } from './common.ts';

export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
/** Lifetime of the `client_secret` JWT. Apple takes up to six months. */
const CLIENT_SECRET_SECONDS = 300n;

export interface AppleConfig {
  readonly app_id: string;
  readonly team_id: string;
  readonly key_id: string;
  /** The Sign in with Apple private key (`.p8` PEM) of secret `loginApple`. */
  readonly private_key_pem: string;
  readonly jwks_cache_ms: bigint;
  readonly max_response_bytes: number;
}

/** The private key of a `.p8` PEM; null when the PEM is not an EC private key. */
export function apple_private_key(pem: string): KeyObject | null {
  try {
    const key = createPrivateKey(pem);
    return key.asymmetricKeyType === 'ec' ? key : null;
  } catch {
    return null;
  }
}

/** The ES256 `client_secret` JWT: `iss` team ID, `kid` key ID, `sub` app ID, `aud` Apple. */
function client_secret(config: AppleConfig, key: KeyObject, now_ms: bigint): string {
  const iat = now_ms / 1000n;
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: config.key_id }), 'utf8').toString('base64url');
  const payload = Buffer.from(`{"aud":"${APPLE_ISSUER}","exp":${(iat + CLIENT_SECRET_SECONDS).toString()},"iat":${iat.toString()},"iss":${JSON.stringify(config.team_id)},"sub":${JSON.stringify(config.app_id)}}`, 'utf8').toString('base64url');
  const input = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(input, 'ascii'), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

export function create_login_apple(config: AppleConfig, http: HttpAdapter, key_source: KeySource, now: () => bigint): AppleAdapter | null {
  const key = apple_private_key(config.private_key_pem);
  if (key === null) return null;
  const jwks = new JwksCache(key_source, config.jwks_cache_ms, now);
  const form = (extra: Record<string, string>): Record<string, string> => ({ ...extra, client_id: config.app_id, client_secret: client_secret(config, key, now()) });
  return {
    async verify(credential, signal) {
      const parsed = parse_apple_credential(credential);
      if (parsed === null) return rejected;
      return verify_id_token(parsed.identity_token, jwks, { issuers: [APPLE_ISSUER], audiences: [config.app_id] }, now(), signal);
    },
    async exchange(credential, signal) {
      const parsed = parse_apple_credential(credential);
      if (parsed === null) return rejected;
      const response = await post_form(http, APPLE_TOKEN_URL, form({ grant_type: 'authorization_code', code: parsed.authorization_code }), config.max_response_bytes, signal);
      if (!response.ok) return response;
      const refresh_token = response.value.refresh_token;
      return typeof refresh_token === 'string' && refresh_token !== '' ? ok(refresh_token) : rejected;
    },
    async revoke(refresh_token, signal) {
      const response = await post_form(http, APPLE_REVOKE_URL, form({ token: refresh_token, token_type_hint: 'refresh_token' }), config.max_response_bytes, signal);
      return response.ok ? ok(true) : response;
    },
  };
}
