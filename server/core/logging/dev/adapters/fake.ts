import type { AdapterFailure, AnalyticsAdapter, AnalyticsSendEvent } from '../../analytics.ts';

/** One call the fake adapter received: `send` with the event list, `delete_user_data` with the user ID. */
export interface FakeCall {
  readonly operation: 'send' | 'delete_user_data';
  readonly input: readonly AnalyticsSendEvent[] | bigint;
}

/**
 * The fake adapter controller (`testing.fake` service `analytics`). A result or failure condition holds for every call
 * of that operation until it is set again; a failure condition wins over the result.
 */
export interface FakeAnalyticsController {
  /** `delete_user_data`: its success flag. Starts as `true`. */
  set_result(operation: string, result: unknown): void;
  /**
   * `send`, `delete_user_data`: the failure condition of the next calls, or null to clear it. `timeout` ends the call
   * when the time limit signal aborts; `communication_failure` and `rejected` fail at once.
   */
  set_failure(operation: string, failure: AdapterFailure | null): void;
  /** The calls received, in order, failed calls too. */
  calls(): readonly FakeCall[];
}

const OPERATIONS: ReadonlySet<string> = new Set(['send', 'delete_user_data']);
const FAILURES: ReadonlySet<unknown> = new Set(['timeout', 'communication_failure', 'rejected', null]);

/** Ends when the signal aborts. */
function wait_abort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

/** The fake analytics adapter and its controller. Throws for an adapter key other than `analytics`. */
export function create_fake_adapter(adapter_key: string): { adapter: AnalyticsAdapter; controller: FakeAnalyticsController } {
  if (adapter_key !== 'analytics') throw new TypeError(`logging: no fake adapter for adapter key ${adapter_key}`);
  const calls: FakeCall[] = [];
  const failures = new Map<string, AdapterFailure>();
  let delete_ok = true;
  const adapter: AnalyticsAdapter = {
    async send(events, signal) {
      calls.push({ operation: 'send', input: [...events] });
      const failure = failures.get('send') ?? null;
      if (failure === 'timeout') await wait_abort(signal);
      return failure;
    },
    async delete_user_data(user_id, signal) {
      calls.push({ operation: 'delete_user_data', input: user_id });
      const failure = failures.get('delete_user_data') ?? null;
      if (failure === 'timeout') await wait_abort(signal);
      return failure === null && delete_ok;
    },
  };
  const controller: FakeAnalyticsController = {
    set_result(operation, result) {
      if (operation !== 'delete_user_data') throw new TypeError(`fake analytics: operation ${operation} has no result to set`);
      if (typeof result !== 'boolean') throw new TypeError('fake analytics: the delete_user_data result is a success flag');
      delete_ok = result;
    },
    set_failure(operation, failure) {
      if (!OPERATIONS.has(operation)) throw new TypeError(`fake analytics: unknown operation ${operation}`);
      if (!FAILURES.has(failure)) throw new TypeError(`fake analytics: unknown failure condition ${String(failure)}`);
      if (failure === null) failures.delete(operation);
      else failures.set(operation, failure);
    },
    calls: () => [...calls],
  };
  return { adapter, controller };
}
