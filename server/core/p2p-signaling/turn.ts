/** A failure of a `turn` adapter call. */
export type TurnFailure = 'timeout' | 'communication_failure' | 'rejected';

/** One relay a `turn` adapter issued: a relay URL and its short-lived credential. */
export interface TurnRelayCredential {
  readonly url: string;
  readonly username: string;
  readonly credential: string;
}

/**
 * The `turn` adapter interface. `issue_relays` issues the relays of one match whose credentials hold until
 * `expires_at` (Unix ms). `signal` aborts when the call's time limit `p2p-signaling.turnTimeoutMs` has passed.
 */
export interface TurnAdapter {
  issue_relays(match_id: string, expires_at: bigint, signal: AbortSignal): Promise<readonly TurnRelayCredential[] | TurnFailure>;
}

export function is_turn_adapter(value: unknown): value is TurnAdapter {
  const adapter = value as Partial<TurnAdapter> | null | undefined;
  return typeof adapter?.issue_relays === 'function';
}

/** True for a list of relays with string `url`, `username` and `credential`. */
export function is_relay_list(value: unknown): value is readonly TurnRelayCredential[] {
  if (!Array.isArray(value)) return false;
  return value.every((relay: unknown) => {
    const r = relay as Partial<TurnRelayCredential> | null | undefined;
    return typeof r?.url === 'string' && typeof r.username === 'string' && typeof r.credential === 'string';
  });
}

/** Resolves with `timeout` when the signal aborts. */
export function on_abort(signal: AbortSignal): Promise<TurnFailure> {
  if (signal.aborted) return Promise.resolve('timeout');
  return new Promise((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve('timeout');
      },
      { once: true },
    );
  });
}
