/**
 * The fake adapter of `push-fcm` and `push-apns` (`push` `### adapter`, `## DEV`): `OK` for a token starting with
 * `fake:`, `INVALID_TOKEN` for any other, unless the controller sets the results.
 */
import type { AdapterKey, PushAdapter, PushPayload, SendResult } from '../../adapter.ts';

/** A failure condition of `testing`'s fake adapter controller. */
export type FakeFailure = 'timeout' | 'communication_failure' | 'rejected';

/** One `send` call the fake adapter received. */
export interface FakeCall {
  readonly operation: 'send';
  readonly input: { readonly tokens: readonly string[]; readonly payload: PushPayload };
}

/**
 * The fake adapter controller (`testing` `fake`). The operation is `send`. Its result is an object of results by
 * device token (`OK`, `INVALID_TOKEN`, `FAILED`); a token it does not name takes the default result.
 * `timeout` waits until the time limit signal aborts; `communication_failure` and `rejected` fail at once. A
 * failed call is `FAILED` for every token.
 */
export interface FakeController {
  set_result(operation: string, result: unknown): void;
  set_failure(operation: string, failure: FakeFailure | null): void;
  calls(): FakeCall[];
}

const RESULTS = new Set<string>(['OK', 'INVALID_TOKEN', 'FAILED']);

function check_operation(operation: string): void {
  if (operation !== 'send') throw new Error(`fake push adapter: no operation ${operation}`);
}

/** Makes the fake adapter of an adapter key and its controller. */
export function create_fake_adapter(key: AdapterKey): { adapter: PushAdapter; controller: FakeController } {
  let results = new Map<string, SendResult>();
  let failure: FakeFailure | null = null;
  const calls: FakeCall[] = [];
  const adapter: PushAdapter = {
    send: async (tokens, payload, signal) => {
      calls.push({ operation: 'send', input: { tokens: [...tokens], payload } });
      if (failure === 'timeout') {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          signal.addEventListener('abort', () => {
            resolve();
          }, { once: true });
        });
      }
      if (failure !== null) return tokens.map(() => 'FAILED');
      return tokens.map((t) => results.get(t) ?? (t.startsWith('fake:') ? 'OK' : 'INVALID_TOKEN'));
    },
  };
  const controller: FakeController = {
    set_result: (operation, result) => {
      check_operation(operation);
      if (typeof result !== 'object' || result === null) throw new Error(`fake ${key}: the send result is not an object of results by device token`);
      const next = new Map<string, SendResult>();
      for (const [token, value] of Object.entries(result)) {
        if (typeof value !== 'string' || !RESULTS.has(value)) throw new Error(`fake ${key}: ${String(value)} is not a send result`);
        next.set(token, value as SendResult);
      }
      results = next;
    },
    set_failure: (operation, value) => {
      check_operation(operation);
      failure = value;
    },
    calls: () => [...calls],
  };
  return { adapter, controller };
}
