/**
 * The fake `cdn` adapter (`game-update` `### CDN adapter`) and its `testing.fake` controller. Until the controller
 * sets a `base_url` result the adapter counts as no adapter (`base_url()` is null). A result or failure condition
 * holds for every call of that operation until it is set again; a failure condition wins over the result.
 */
import type { CdnAdapter } from '../../cdn.ts';

/** A failure condition of `testing`'s fake adapter controller, or null to clear it. */
export type FakeFailure = 'timeout' | 'communication_failure' | 'rejected' | null;

/** One call the fake adapter received: `base_url` with no input, `put` with `{sha256, bytes}`. */
export interface FakeCdnCall {
  readonly operation: 'base_url' | 'put';
  readonly input: null | { readonly sha256: string; readonly bytes: Uint8Array };
}

/** The fake adapter controller (`testing.fake` service `cdn`). */
export interface FakeCdnController {
  /** `base_url`: an absolute URL, or null for no adapter. `put`: its success flag; `true` until set. */
  set_result(operation: string, result: unknown): void;
  /** `put`: the failure condition of the next calls. `timeout` waits for the `game-update.cdnTimeoutMs` time limit. */
  set_failure(operation: string, failure: FakeFailure): void;
  /** The calls received, in order, failed calls too. */
  calls(): readonly FakeCdnCall[];
}

const FAILURES: ReadonlySet<unknown> = new Set(['timeout', 'communication_failure', 'rejected', null]);

function is_absolute_url(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function wait_abort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      resolve();
    }, { once: true });
  });
}

/** The fake `cdn` adapter and its controller. Throws for an adapter key other than `cdn`. */
export function create_fake_adapter(adapter_key: string): { adapter: CdnAdapter; controller: FakeCdnController } {
  if (adapter_key !== 'cdn') throw new TypeError(`game-update: no fake adapter for adapter key ${adapter_key}`);
  const calls: FakeCdnCall[] = [];
  let base_url: string | null = null;
  let put_ok = true;
  let put_failure: FakeFailure = null;
  const adapter: CdnAdapter = {
    base_url: () => {
      calls.push({ operation: 'base_url', input: null });
      return base_url;
    },
    put: async (sha256, bytes, signal) => {
      calls.push({ operation: 'put', input: { sha256, bytes } });
      if (put_failure === 'timeout') {
        await wait_abort(signal);
        return false;
      }
      return put_failure === null && put_ok && !signal.aborted;
    },
  };
  const controller: FakeCdnController = {
    set_result(operation, result) {
      if (operation === 'base_url') {
        if (result !== null && !is_absolute_url(result)) throw new TypeError('fake cdn: the base_url result is an absolute URL or null');
        base_url = result;
      } else if (operation === 'put') {
        if (typeof result !== 'boolean') throw new TypeError('fake cdn: the put result is a success flag');
        put_ok = result;
      } else {
        throw new TypeError(`fake cdn: unknown operation ${operation}`);
      }
    },
    set_failure(operation, failure) {
      if (operation !== 'put') throw new TypeError(`fake cdn: operation ${operation} has no failure condition`);
      if (!FAILURES.has(failure)) throw new TypeError(`fake cdn: unknown failure condition ${String(failure)}`);
      put_failure = failure;
    },
    calls: () => [...calls],
  };
  return { adapter, controller };
}
