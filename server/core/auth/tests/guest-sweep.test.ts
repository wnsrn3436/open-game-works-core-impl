import * as iap from '../../iap/tests/helpers.ts';
import { E, P, auto_login, guest, logs, missing, probe, social, start, testing, type TestServer } from './helpers.ts';

const INTERVAL = 1000n;
const BATCH = 2;

/** Moves the clock one sweep interval and lets the job run, as many times as the batches of `users` need. */
async function sweep(server: TestServer, users: number): Promise<void> {
  for (let i = 0; i < Math.ceil(users / BATCH); i += 1) {
    testing.advance_time(server, INTERVAL);
    await testing.wait_background(server);
  }
}

describe('job auth_guest_sweep', () => {
  it('deletes nobody when auth.inactiveGuestDeleteAfterMs is null', async () => {
    const server = await start({ settings: { 'auth.inactiveGuestDeleteAfterMs': null, 'auth.guestSweepIntervalMs': Number(INTERVAL), 'auth.guestSweepBatchSize': BATCH } });
    try {
      const a = await guest(server);
      testing.advance_time(server, 10n * 365n * 86_400_000n);
      await sweep(server, 10);
      expect((await auto_login(server, a.result.login_token)).code).toBe(0);
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it('deletes only guests whose last use + the delete-after time is reached; social users and newer guests stay', async () => {
    const after = 1_000_000n;
    const server = await start({ settings: { 'auth.inactiveGuestDeleteAfterMs': Number(after), 'auth.guestSweepIntervalMs': Number(INTERVAL), 'auth.guestSweepBatchSize': BATCH } });
    try {
      const old_guest = await guest(server);
      const linked = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'sweep-social');
      testing.advance_time(server, after / 2n);
      const new_guest = await guest(server);
      testing.advance_time(server, after / 2n);
      await sweep(server, 6);
      expect(await probe(old_guest.session)).toBe(E.CORE_ERROR_UNAUTHORIZED);
      expect((await auto_login(server, old_guest.result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
      expect((await auto_login(server, linked.result.login_token)).code).toBe(0);
      expect((await auto_login(server, new_guest.result.login_token)).code).toBe(0);
      const audits = (logs(server, 'audit')) as { reason?: unknown; user_id?: unknown }[];
      expect(audits.some((l) => l.reason === 'inactive_guest' && String(l.user_id) === old_guest.result.user_id.toString())).toBe(true);
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it.skipIf(missing('iap'))('keeps a reached guest with a GRANTED payment record that is not a test transaction and deletes one with only test transaction records', async () => {
    const after = 1_000_000n;
    const server = await start({ settings: { 'auth.inactiveGuestDeleteAfterMs': Number(after), 'auth.guestSweepIntervalMs': Number(INTERVAL), 'auth.guestSweepBatchSize': BATCH } });
    try {
      const paying = await guest(server);
      const testing_guest = await guest(server);
      const store = iap.fake_store(server);
      store.set_result('verify', { result: 'VALID', test: false });
      const paid = await iap.verify(paying.session, iap.APPLE, iap.receipt('gems_apple', 'sweep-paid', await iap.account_token(paying.session)));
      expect(iap.status_of(paid)).toBe(iap.Status.PURCHASE_STATUS_GRANTED);
      store.set_result('verify', { result: 'VALID', test: true });
      const tested = await iap.verify(testing_guest.session, iap.APPLE, iap.receipt('gems_apple', 'sweep-test', await iap.account_token(testing_guest.session)));
      expect(iap.status_of(tested)).toBe(iap.Status.PURCHASE_STATUS_GRANTED);
      testing.advance_time(server, after);
      await sweep(server, 4);
      expect((await auto_login(server, paying.result.login_token)).code).toBe(0);
      expect((await auto_login(server, testing_guest.result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    } finally {
      await testing.stop_test_server(server);
    }
  });
});
