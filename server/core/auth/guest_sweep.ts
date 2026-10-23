/**
 * Guest cleanup (`### guest cleanup`): job `auth_guest_sweep` scans `auth.guestSweepBatchSize` users per run after
 * the last user ID it saw (kept in the server instance's memory; back to the start at the end) and withdraws each
 * guest whose last use + `auth.inactiveGuestDeleteAfterMs` is reached, unless `iap` has a granted payment of it.
 */
import { E, audit_log, error_log, type AuthState } from './context.ts';
import type { DbHandle } from './deps.ts';
import { has_social_link, last_token_use } from './tables.ts';
import { withdraw } from './withdraw.ts';

/** True when the user is a guest whose last use + the delete-after time ≤ now. */
function inactive_guest(a: AuthState, db: DbHandle, user_id: bigint, delete_after_ms: bigint): boolean {
  if (has_social_link(db, user_id)) return false;
  const used = last_token_use(db, user_id) ?? a.modules.storage.get_user_record(db, user_id)?.created_at ?? null;
  return used !== null && used + delete_after_ms <= a.modules['server-time'].clock_now();
}

async function sweep_user(a: AuthState, user_id: bigint, delete_after_ms: bigint): Promise<void> {
  const { storage, iap } = a.modules;
  const state = { deleted: false };
  const result = await storage.run_user_transaction(user_id, (ctx) => {
    if (!inactive_guest(a, storage.db(ctx), user_id, delete_after_ms)) return 'pass';
    if (iap !== undefined && iap.has_granted_payment(ctx, user_id)) return 'pass';
    if (withdraw(a, ctx) === 'FAILED') return E.CORE_ERROR_INTERNAL;
    state.deleted = true;
    return 'pass';
  });
  if (result === 'COMMITTED' && state.deleted) audit_log(a, 'inactive guest withdrawn', { user_id, request: 'auth_guest_sweep' }, { reason: 'inactive_guest' });
  else if (result === 'FAILED' || result === 'REJECTED') error_log(a, 'inactive guest deletion failed; the next scan tries again', { user_id, request: 'auth_guest_sweep' });
}

/** The job function, with the scan position of this server instance. */
export function guest_sweep_job(a: AuthState, delete_after_ms: bigint): () => Promise<void> {
  let last_user_id = 0n;
  return async () => {
    const { storage } = a.modules;
    const batch = a.settings.guest_sweep_batch_size;
    const users = storage.scan_users(storage.read_db(), last_user_id, batch);
    last_user_id = users.length < batch ? 0n : (users[users.length - 1] ?? 0n);
    for (const user_id of users) {
      if (inactive_guest(a, storage.read_db(), user_id, delete_after_ms)) await sweep_user(a, user_id, delete_after_ms);
    }
  };
}
