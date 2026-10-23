/**
 * The fake adapter of `login-apple` and `login-google` (`### external service`). A credential `fake:<text>` is the
 * social account `<text>`; any other form is refused. Apple `exchange` gives `fake:<provider account ID>` and
 * `revoke` succeeds; Google `exchange_desktop` checks the desktop credential like the real adapter and gives
 * `fake:<authorization_code>`. Its controller (`testing.fake`) sets the result and failure condition of each
 * operation and reads the calls.
 */
import { ok, parse_desktop_credential, rejected, type AdapterFailure, type AdapterResult, type AppleAdapter, type GoogleAdapter } from '../../adapters/common.ts';

export type FakeOperation = 'verify' | 'exchange' | 'revoke' | 'exchange_desktop';

/** A failure condition of the fake adapter controller (`testing` `## DEV`). */
export type FakeFailure = 'timeout' | 'communication_failure' | 'rejected';

export interface FakeCall {
  readonly operation: FakeOperation;
  /** The credential, desktop credential or refresh token the call got. */
  readonly input: string;
}

const FAILURES: Readonly<Record<FakeFailure, AdapterFailure>> = { timeout: 'timeout', communication_failure: 'communication', rejected: 'rejected' };

export class FakeLoginAdapter implements AppleAdapter, GoogleAdapter {
  private readonly results = new Map<FakeOperation, string>();
  private readonly failures = new Map<FakeOperation, AdapterFailure>();
  private readonly recorded: FakeCall[] = [];

  readonly service: 'login-apple' | 'login-google';

  constructor(service: 'login-apple' | 'login-google') {
    this.service = service;
  }

  /** Sets the output of every call of `operation` from now on: the provider account ID, refresh token or ID token. */
  set_result(operation: FakeOperation, result: string): void {
    this.results.set(operation, result);
  }

  /** Makes every call of `operation` fail from now on; null clears it. A failure condition wins over a result. */
  set_failure(operation: FakeOperation, failure: FakeFailure | null): void {
    if (failure === null) this.failures.delete(operation);
    else this.failures.set(operation, FAILURES[failure]);
  }

  calls(): readonly FakeCall[] {
    return [...this.recorded];
  }

  /** Records the call; a `timeout` failure condition ends only when the call's time limit signal aborts. */
  private async run(operation: FakeOperation, input: string, signal: AbortSignal, fallback: () => AdapterResult<string>): Promise<AdapterResult<string>> {
    this.recorded.push({ operation, input });
    const failure = this.failures.get(operation);
    if (failure === 'timeout') await aborted(signal);
    if (failure !== undefined) return { ok: false, failure };
    const result = this.results.get(operation);
    return result === undefined ? fallback() : ok(result);
  }

  verify(credential: string, signal: AbortSignal): Promise<AdapterResult<string>> {
    return this.run('verify', credential, signal, () => account_of(credential));
  }

  exchange(credential: string, signal: AbortSignal): Promise<AdapterResult<string>> {
    return this.run('exchange', credential, signal, () => {
      const account = account_of(credential);
      return account.ok ? ok(`fake:${account.value}`) : account;
    });
  }

  async revoke(refresh_token: string, signal: AbortSignal): Promise<AdapterResult<true>> {
    const result = await this.run('revoke', refresh_token, signal, () => ok(''));
    return result.ok ? ok(true as const) : result;
  }

  exchange_desktop(desktop_credential: string, signal: AbortSignal): Promise<AdapterResult<string>> {
    return this.run('exchange_desktop', desktop_credential, signal, () => {
      const parsed = parse_desktop_credential(desktop_credential);
      return parsed === null ? rejected : ok(`fake:${parsed.authorization_code}`);
    });
  }
}

/** Resolves when the signal aborts. */
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => { resolve(); }, { once: true });
  });
}

/** The social account of a credential `fake:<text>`; any other credential is refused. */
function account_of(credential: string): AdapterResult<string> {
  return credential.startsWith('fake:') && credential.length > 'fake:'.length ? ok(credential.slice('fake:'.length)) : rejected;
}

/** A new fake adapter of a service. */
export function create_fake_login_adapter(service: 'login-apple' | 'login-google'): FakeLoginAdapter {
  return new FakeLoginAdapter(service);
}

/** The fake adapter of an adapter key and its controller (`server-core` `## adapter`): the same object. */
export function create_fake_adapter(adapter_key: string): { adapter: FakeLoginAdapter; controller: FakeLoginAdapter } {
  if (adapter_key !== 'login-apple' && adapter_key !== 'login-google') throw new TypeError(`auth: no fake adapter for adapter key ${adapter_key}`);
  const adapter = create_fake_login_adapter(adapter_key);
  return { adapter, controller: adapter };
}
