/**
 * The content `register` of `concurrency.test.ts`, for a test server, its peers and its peer processes
 * (`ledger_peer`): the core test defaults and a `RunCoreTest` handler that changes `[gold]` by `delta_of(request ID)`
 * with `add_items` or `subtract_items`. `NOT_ENOUGH` is `GAME_ERROR_CORE_TEST`; another change result throws. In the
 * process that runs it, the handler keeps the balance before and after each request ID's change in `seen`. In a peer
 * process it also marks gate `seen_gate(request ID)` reached with `seen_note` of them; the test opens that gate before
 * it sends the request, so the handler does not wait there.
 */
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import type { PeerContext, PeerRegister } from '../../testing/dev/index.ts';
import { core_test_register } from '../../testing/dev/runner_input.ts';
import { ItemChangeResult, type ItemLedgerContent } from '../index.ts';
import { amount, id } from './helpers.ts';

export const GRANT = 10n;
export const SPEND = 25n;

/** The `[gold]` change of a request ID (lower case UUID v4): a spend for `0` to `3` first, else a grant. */
export function delta_of(request_id: string): bigint {
  return request_id < '4' ? -SPEND : GRANT;
}

export interface Seen {
  readonly before: bigint;
  readonly after: bigint;
  readonly outcome: unknown;
}

/** What each `RunCoreTest` of this process saw, by request ID: the last run's. */
export const seen = new Map<string, Seen>();

/** The peer process gate whose note is what the `RunCoreTest` of `request_id` saw there. */
export function seen_gate(request_id: string): string {
  return `seen-${request_id}`;
}

/** `s` as a gate note. */
function seen_note(s: Seen): string {
  return JSON.stringify({ before: String(s.before), after: String(s.after), outcome: String(s.outcome) });
}

/** The `Seen` of a `seen_gate` note. */
export function read_seen_note(note: string): Seen {
  const s = JSON.parse(note) as { before: string; after: string; outcome: string };
  return { before: BigInt(s.before), after: BigInt(s.after), outcome: s.outcome };
}

interface RegisterCore {
  readonly 'item-ledger': ItemLedgerContent;
  readonly routing: { register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void };
}

/** `peer` is the peer context in a peer process, else absent. */
export function ledger_register(given: Readonly<Record<string, unknown>>, peer?: PeerContext): void {
  const core = given as unknown as RegisterCore;
  const ledger = core['item-ledger'];
  const gold = id('[gold]');
  core.routing.register_handler('RunCoreTest', (ctx) => {
    const delta = delta_of(ctx.request_id);
    const before = ledger.get_balance(ctx, gold);
    const outcome = delta > 0n ? ledger.add_items(ctx, [amount('[gold]', delta)]) : ledger.subtract_items(ctx, [amount('[gold]', -delta)]);
    const s: Seen = { before, after: ledger.get_balance(ctx, gold), outcome };
    seen.set(ctx.request_id, s);
    peer?.wait(seen_gate(ctx.request_id), seen_note(s));
    if (outcome === ItemChangeResult.OK) return new GameContract.RunCoreTestResponse();
    if (outcome === ItemChangeResult.NOT_ENOUGH) return GameContract.GameError.GAME_ERROR_CORE_TEST;
    throw new Error(`[gold] change of ${String(delta)}: ${String(outcome)}`);
  });
  core_test_register(given, ['RunCoreTest']);
}

export const ledger_peer: PeerRegister = (peer) => (given) => {
  ledger_register(given, peer);
};
