/** The real adapter `login-google`: Google ID token checks and the desktop credential exchange. */
import type { HttpAdapter, KeySource } from '../deps.ts';
import { JwksCache, ok, parse_desktop_credential, post_form, rejected, verify_id_token, type GoogleAdapter } from './common.ts';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export interface GoogleConfig {
  readonly server_client_id: string;
  readonly ios_client_id: string;
  readonly desktop_client_id: string;
  /** The `loginGoogleDesktop` client secret; empty when the game has no desktop client. */
  readonly desktop_client_secret: string;
  readonly jwks_cache_ms: bigint;
  readonly max_response_bytes: number;
}

export function create_login_google(config: GoogleConfig, http: HttpAdapter, key_source: KeySource, now: () => bigint): GoogleAdapter {
  const jwks = new JwksCache(key_source, config.jwks_cache_ms, now);
  const audiences = [config.server_client_id, config.ios_client_id, config.desktop_client_id].filter((id) => id !== '');
  return {
    verify: (credential, signal) => verify_id_token(credential, jwks, { issuers: GOOGLE_ISSUERS, audiences }, now(), signal),
    async exchange_desktop(desktop_credential, signal) {
      const parsed = parse_desktop_credential(desktop_credential);
      if (parsed === null || config.desktop_client_id === '') return rejected;
      const response = await post_form(
        http,
        GOOGLE_TOKEN_URL,
        {
          grant_type: 'authorization_code',
          code: parsed.authorization_code,
          code_verifier: parsed.code_verifier,
          redirect_uri: parsed.redirect_uri,
          client_id: config.desktop_client_id,
          client_secret: config.desktop_client_secret,
        },
        config.max_response_bytes,
        signal,
      );
      if (!response.ok) return response;
      // The access token and the other tokens of the response are dropped here.
      const id_token = response.value.id_token;
      return typeof id_token === 'string' && id_token !== '' ? ok(id_token) : rejected;
    },
  };
}
