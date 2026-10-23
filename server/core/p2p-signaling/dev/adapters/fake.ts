import { is_relay_list, on_abort, type TurnAdapter, type TurnFailure, type TurnRelayCredential } from '../../turn.ts';

/** The operation of the fake `turn` adapter. */
const ISSUE_RELAYS = 'issue_relays';

/** One call the fake adapter received: `issue_relays` with the match ID and the credential expiry. */
export interface FakeTurnCall {
  readonly operation: typeof ISSUE_RELAYS;
  readonly input: { readonly match_id: string; readonly expires_at: bigint };
}

/**
 * The fake adapter controller (`testing.fake` service `turn`). A result or failure condition holds for every call
 * until it is set again; a failure condition wins over the result.
 */
export interface FakeTurnController {
  /** `issue_relays`: the relay list (`url`, `username`, `credential` strings). Starts as the empty list. */
  set_result(operation: string, result: unknown): void;
  /**
   * `issue_relays`: the failure condition of the next calls, or null to clear it. With `timeout` the call ends only
   * when its time limit signal aborts.
   */
  set_failure(operation: string, failure: TurnFailure | null): void;
  /** The calls received, in order, failed calls too. */
  calls(): readonly FakeTurnCall[];
}

const FAILURES: ReadonlySet<unknown> = new Set(['timeout', 'communication_failure', 'rejected', null]);

function check_operation(operation: string): void {
  if (operation !== ISSUE_RELAYS) throw new TypeError(`fake turn: unknown operation ${operation}`);
}

/** The fake `turn` adapter and its controller. Throws for an adapter key other than `turn`. */
export function create_fake_adapter(adapter_key: string): { adapter: TurnAdapter; controller: FakeTurnController } {
  if (adapter_key !== 'turn') throw new TypeError(`p2p-signaling: no fake adapter for adapter key ${adapter_key}`);
  const calls: FakeTurnCall[] = [];
  let relays: readonly TurnRelayCredential[] = [];
  let failure: TurnFailure | null = null;
  const adapter: TurnAdapter = {
    issue_relays(match_id, expires_at, signal) {
      calls.push({ operation: ISSUE_RELAYS, input: { match_id, expires_at } });
      if (failure === 'timeout') return on_abort(signal);
      if (failure !== null) return Promise.resolve(failure);
      return Promise.resolve(relays.map((relay) => ({ ...relay })));
    },
  };
  const controller: FakeTurnController = {
    set_result(operation, result) {
      check_operation(operation);
      if (!is_relay_list(result)) throw new TypeError('fake turn: the issue_relays result is a list of {url, username, credential} strings');
      relays = result.map((relay) => ({ url: relay.url, username: relay.username, credential: relay.credential }));
    },
    set_failure(operation, value) {
      check_operation(operation);
      if (!FAILURES.has(value)) throw new TypeError(`fake turn: unknown failure condition ${String(value)}`);
      failure = value;
    },
    calls: () => [...calls],
  };
  return { adapter, controller };
}
