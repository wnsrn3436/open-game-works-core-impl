/**
 * The content `register` of a guild peer process (`testing` `start_peer_process`): the core test defaults and an
 * `on_guild_member_changed` hook that waits at gate `joined-<user ID>` on the `Joined` of another user than the ctx
 * user, which is the `Joined` of `AcceptGuildJoinRequest` (`CreateGuild` and `JoinGuild` join the ctx user). The hook
 * runs in the transaction that added the member row, after the guild row and member row locks, so the transaction
 * holds them at the gate. The gate note is the backend pid of that transaction on PostgreSQL.
 */
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { core_test_register, type PeerRegister } from '../../testing/dev/index.ts';
import type { GuildMemberChange } from '../index.ts';

interface Routing {
  register_hook(module: string, hook: string, fn: unknown): void;
}

export function joined_gate(user_id: bigint): string {
  return `joined-${String(user_id)}`;
}

export const guild_peer: PeerRegister = (peer) => (core) => {
  core_test_register(core);
  (core as unknown as { routing: Routing }).routing.register_hook('guild', 'on_guild_member_changed', (ctx: RequestCtx, _guild_id: bigint, user_id: bigint, change: GuildMemberChange) => {
    if (change !== 'Joined' || user_id === ctx.user_id) return;
    const storage = peer.modules().get('storage') as unknown as Storage;
    const pid = storage.db(ctx).query('SELECT pg_backend_pid() AS pid')[0]?.['pid'];
    peer.wait(joined_gate(user_id), String(pid));
  });
};
