/**
 * The withdrawal of `Withdraw`, `withdraw_user`, web account deletion, `ConfirmAge` below the minimum age and the
 * guest cleanup: `remove_user` of `ranking`, `push`, `iap`, `chat`, `friend`, `guild`, `block-report` (those on the
 * server module list, in this order), `logging.request_analytics_deletion`, `storage.delete_user`, and after commit
 * the revoke of the user's Apple refresh token.
 */
import type { AuthState } from './context.ts';
import type { Ctx } from './deps.ts';
import { revoke_apple } from './social.ts';
import { apple_token } from './tables.ts';

/** `FAILED` when a `remove_user` failed: nothing after it ran and the caller rolls the transaction back. */
export function withdraw(a: AuthState, ctx: Ctx): 'done' | 'FAILED' {
  const m = a.modules;
  const refresh_token = apple_token(m.storage.db(ctx), ctx.user_id);
  const steps = [m.ranking, m.push, m.iap, m.chat, m.friend, m.guild, m['block-report']];
  for (const module of steps) {
    if (module === undefined) continue;
    if (module.remove_user(ctx) === 'FAILED') return 'FAILED';
  }
  m.logging.request_analytics_deletion(ctx);
  m.storage.delete_user(ctx);
  if (refresh_token !== null) {
    const user_id = ctx.user_id;
    m.storage.after_commit(ctx, () => revoke_apple(a, refresh_token, user_id));
  }
  return 'done';
}
