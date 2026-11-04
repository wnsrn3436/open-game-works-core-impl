/**
 * The content `register` of a block-report peer process (`testing` `start_peer_process`): the core test defaults,
 * `RunCoreTest` that reports the first user the ctx user blocked with `add_report` and waits at gate `reported` in the
 * transaction that holds the `block_report_sequence` lock, and a `remove_user` that waits at gate `removed` in the same
 * way before the withdrawal is written. The gate note is the backend pid of that transaction.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { core_test_register, load_data, type PeerRegister } from '../../testing/dev/index.ts';
import type { BlockReport } from '../index.ts';

export const EVIDENCE = 'message of the target';
export const REPORTED_GATE = 'reported';
export const REMOVED_GATE = 'removed';

interface Routing {
  register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void;
}

export const block_report_peer: PeerRegister = (peer) => (core) => {
  const block = (core as unknown as Record<string, unknown>)['block-report'] as BlockReport;
  const pid_of = (ctx: RequestCtx): string => {
    const storage = peer.modules().get('storage') as unknown as Storage;
    return String(storage.db(ctx).query('SELECT pg_backend_pid() AS pid')[0]?.['pid']);
  };
  (core as unknown as { routing: Routing }).routing.register_handler('RunCoreTest', (ctx) => {
    const [target] = block.list_blocked_ids(ctx, ctx.user_id);
    if (target === undefined) throw new Error('block_report_peer: the ctx user blocked nobody');
    const reason_id = load_data().dev.find_id_value('[report_reason_spam]');
    const result = block.add_report(ctx, target, reason_id, CoreContract.ReportContext.REPORT_CONTEXT_CHAT, 'r', '', EVIDENCE);
    if (result !== 'OK') throw new Error(`block_report_peer: add_report is ${result}`);
    peer.wait(REPORTED_GATE, pid_of(ctx));
    return new GameContract.RunCoreTestResponse();
  });
  core_test_register(core, ['RunCoreTest']);
  const remove_user = block.remove_user.bind(block);
  block.remove_user = (ctx) => {
    const removed = remove_user(ctx);
    peer.wait(REMOVED_GATE, pid_of(ctx));
    return removed;
  };
};
