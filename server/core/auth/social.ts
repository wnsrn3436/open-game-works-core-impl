/**
 * Social credential checks outside any transaction (`### external service`): `verify` (after `exchange_desktop` for
 * a Google desktop credential, followed by `exchange` for Apple), each call under `auth.socialVerifyTimeoutMs`.
 * A refusal is `SOCIAL_LOGIN_INVALID` with a `security` log; a time limit or communication failure is
 * `EXTERNAL_SERVICE_FAILED` with an `error` log. Credentials, codes and tokens are never logged.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import { is_desktop_credential, type AdapterResult, type SocialAdapter } from './adapters/common.ts';
import { E, error_log, security_log, type AuthState } from './context.ts';
import type { CoreErrorCode } from './deps.ts';

export interface SocialAccount {
  /** `LOGIN_PROVIDER_APPLE` or `LOGIN_PROVIDER_GOOGLE`. */
  readonly provider: 'LOGIN_PROVIDER_APPLE' | 'LOGIN_PROVIDER_GOOGLE';
  readonly account_id: string;
  /** The Apple refresh token of `exchange`; null for Google. */
  readonly refresh_token: string | null;
}

export interface SocialLogTarget {
  readonly user_id: bigint | null;
  readonly request_id: string | null;
  readonly request: string;
  readonly ip: string;
}

/** The social provider name of a provider value, or null when it is not a social provider. */
export function social_provider(provider: number): SocialAccount['provider'] | null {
  if (provider === CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE) return 'LOGIN_PROVIDER_APPLE';
  if (provider === CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE) return 'LOGIN_PROVIDER_GOOGLE';
  return null;
}

/** The adapter of a social provider in this environment, or null when there is none. */
export function adapter_of(a: AuthState, provider: SocialAccount['provider']): SocialAdapter | null {
  return provider === 'LOGIN_PROVIDER_APPLE' ? a.apple : a.google;
}

/** Calls an adapter operation under the time limit; an exception is a communication failure. */
export async function timed<T>(a: AuthState, call: (signal: AbortSignal) => Promise<AdapterResult<T>>): Promise<AdapterResult<T>> {
  const signal = a.modules['server-time'].network_time_limit(a.settings.social_verify_timeout_ms);
  const timeout = new Promise<AdapterResult<T>>((resolve) => {
    if (signal.aborted) resolve({ ok: false, failure: 'timeout' });
    else signal.addEventListener('abort', () => { resolve({ ok: false, failure: 'timeout' }); }, { once: true });
  });
  const result = call(signal).catch((): AdapterResult<T> => ({ ok: false, failure: signal.aborted ? 'timeout' : 'communication' }));
  return Promise.race([result, timeout]);
}

function fail(a: AuthState, result: Exclude<AdapterResult<unknown>, { ok: true }>, target: SocialLogTarget, operation: string): CoreErrorCode {
  if (result.failure === 'rejected') {
    security_log(a, `social credential refused by ${operation}`, target, 'social_login_invalid', target.ip);
    return E.CORE_ERROR_SOCIAL_LOGIN_INVALID;
  }
  error_log(a, `social login adapter ${operation} failed: ${result.failure === 'timeout' ? 'time limit passed' : 'communication failure'}`, target);
  return E.CORE_ERROR_EXTERNAL_SERVICE_FAILED;
}

/**
 * The social account of a credential. The caller checked that the provider is a social provider with an adapter in
 * this environment.
 */
export async function verify_credential(a: AuthState, provider: SocialAccount['provider'], credential: string, target: SocialLogTarget): Promise<SocialAccount | CoreErrorCode> {
  if (provider === 'LOGIN_PROVIDER_GOOGLE') {
    const google = a.google;
    if (google === null) return E.CORE_ERROR_INVALID_REQUEST;
    let id_token = credential;
    if (is_desktop_credential(credential)) {
      const exchanged = await timed(a, (signal) => google.exchange_desktop(credential, signal));
      if (!exchanged.ok) return fail(a, exchanged, target, 'exchange_desktop');
      id_token = exchanged.value;
    }
    const verified = await timed(a, (signal) => google.verify(id_token, signal));
    if (!verified.ok) return fail(a, verified, target, 'verify');
    return { provider, account_id: verified.value, refresh_token: null };
  }
  const apple = a.apple;
  if (apple === null) return E.CORE_ERROR_INVALID_REQUEST;
  const verified = await timed(a, (signal) => apple.verify(credential, signal));
  if (!verified.ok) return fail(a, verified, target, 'verify');
  const exchanged = await timed(a, (signal) => apple.exchange(credential, signal));
  if (!exchanged.ok) return fail(a, exchanged, target, 'exchange');
  return { provider, account_id: verified.value, refresh_token: exchanged.value };
}

/** Revokes an Apple refresh token after a withdrawal; a failure only leaves an `error` log. */
export async function revoke_apple(a: AuthState, refresh_token: string, user_id: bigint): Promise<void> {
  const apple = a.apple;
  if (apple === null) {
    error_log(a, 'Apple refresh token revoke skipped: no login-apple adapter in this environment', { user_id });
    return;
  }
  const result = await timed(a, (signal) => apple.revoke(refresh_token, signal));
  if (!result.ok) error_log(a, `Apple refresh token revoke failed: ${result.failure}`, { user_id });
}
