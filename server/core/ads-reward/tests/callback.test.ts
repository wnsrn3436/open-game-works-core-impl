import { Buffer } from 'node:buffer';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { DbError } from '../../storage/db/types.ts';
import { lock_holder, stop_all } from '../../storage/tests/helpers.ts';
import type { TestServer as LocalTestServer } from '../../testing/dev/index.ts';
import { IP_COUNTER_TABLE } from '../tickets.ts';
import {
  BASIC,
  balance,
  callback,
  claim,
  error_of,
  GEM,
  hooks,
  MINUTE_MS,
  notify_of,
  query_with_key,
  signed,
  start,
  T,
  T0,
  user,
  type Started,
  type TestServer,
} from './helpers.ts';

function calls_of(s: Started, operation: string): number {
  return s.ads.calls().filter((c) => c.operation === operation).length;
}

/** The `error` log lines of a failed signing key fetch. */
function key_fetch_errors(s: Started): number {
  return T.read_logs(s.server, 'error', 'error').filter((l) => l.message.startsWith('ads signing key fetch of ')).length;
}

/**
 * Opens a transaction on another connection to the test server's DB that blocks writes to `ads_reward_ip_counter`
 * (on SQLite, `BEGIN IMMEDIATE` blocks every write transaction). The returned function rolls it back.
 */
async function block_ip_counter(server: TestServer): Promise<() => Promise<void>> {
  const database = (server as unknown as LocalTestServer).shared.database;
  const holder = await lock_holder({ kind: database.kind, db: database.db_argument, secrets: { db: database.connection ?? '' } });
  if (database.kind === 'postgresql') {
    await holder.ok('BEGIN');
    await holder.ok(`LOCK TABLE ${IP_COUNTER_TABLE} IN EXCLUSIVE MODE`);
  } else {
    await holder.ok('BEGIN IMMEDIATE');
  }
  return async () => {
    await holder.ok('ROLLBACK');
  };
}

describe('ads-reward callback route', () => {
  it('answers HTTP 404 to GET /ads/callback/fake and GET /ads/callback/admob on a STG test server', async () => {
    const server = await T.start_test_server(undefined, undefined, 'STG');
    try {
      expect((await T.send_raw(server, 'GET', '/ads/callback/fake?a=b', {}, null)).status).toBe(404);
      expect((await T.send_raw(server, 'GET', '/ads/callback/admob?a=b', {}, null)).status).toBe(404);
    } finally {
      await T.stop_test_server(server);
    }
  });

  it('answers HTTP 404 to a network that is not the selected adapter network', async () => {
    const s = await start();
    try {
      expect((await callback(s.server, 'a=b', 'admob')).status).toBe(404);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('answers HTTP 400 to a malformed query', async () => {
    const s = await start();
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      const good = s.ads.sign_callback(notify_id, session.user_id, 1n);
      expect((await callback(s.server, good.replace('&user_id=', '&uid='))).status).toBe(400);
      expect((await callback(s.server, `${good}&x=y`)).status).toBe(400);
      expect((await callback(s.server, good)).status).toBe(200);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('answers HTTP 400 without parse to a well-formed query over maxQueryBytes', async () => {
    // A fake ads query is at least 119 bytes: 36 byte notify ID, 1 digit user ID and key ID, 43 byte signature.
    const s = await start({ 'ads-reward.maxQueryBytes': 118 });
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      const good = s.ads.sign_callback(notify_id, session.user_id, 1n);
      expect(Buffer.byteLength(good, 'utf8')).toBeGreaterThan(118);
      const parsed = calls_of(s, 'parse');
      expect((await callback(s.server, good)).status).toBe(400);
      expect(calls_of(s, 'parse')).toBe(parsed);
      expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
      expect((await callback(s.server, 'bad')).status).toBe(400);
      expect(calls_of(s, 'parse')).toBe(parsed + 1);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('answers HTTP 429 without parse, fetch_keys and verify once the failed callbacks of an IP reach the limit, and takes them again in the next minute window', async () => {
    const s = await start({ 'ads-reward.callbackRateLimitPerMinute': 3 });
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      expect((await callback(s.server, 'bad')).status).toBe(400);
      expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(403);
      expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(403);
      const before = s.ads.calls().length;
      expect((await signed(s, notify_id, session.user_id)).status).toBe(429);
      expect(s.ads.calls().length).toBe(before);
      expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
      expect(T.read_logs(s.server, 'security').some((l) => l.reason === 'rate_limited_ip')).toBe(true);

      T.advance_time(s.server, MINUTE_MS);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(await balance(s.server, session.user_id, GEM())).toBe(10n);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('does not count callbacks with a good signature: more than the limit of them are not HTTP 429', async () => {
    const s = await start({ 'ads-reward.callbackRateLimitPerMinute': 2 });
    try {
      const session = await user(s.server);
      for (let i = 0; i < 4; i += 1) {
        const notify_id = await notify_of(session, BASIC());
        expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
        expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      }
      const notify_id = await notify_of(session, BASIC());
      expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(403);
      expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(403);
      expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(429);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('answers HTTP 200 without claim_notify, a grant or a count, and with one warn log each, to signed callbacks whose user ID is x or whose reward notify ID is 37 bytes', async () => {
    // With maxNotifyIdBytes 36, claim_notify of the 37 byte reward notify ID would throw: HTTP 500.
    const s = await start({ 'ads-reward.callbackRateLimitPerMinute': 1, 'idempotency.maxNotifyIdBytes': 36 });
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      const bad = [
        s.ads.sign_callback(notify_id, 'x', 1n),
        s.ads.sign_callback(`${notify_id}0`, session.user_id, 1n),
        s.ads.sign_callback(notify_id.toUpperCase(), session.user_id, 1n),
        s.ads.sign_callback(notify_id, '0', 1n),
        s.ads.sign_callback(notify_id, '', 1n),
        s.ads.sign_callback('', session.user_id, 1n),
      ];
      const warned = T.read_logs(s.server, 'core', 'warn').length;
      for (const query of bad) expect((await callback(s.server, query)).status).toBe(200);
      const warns = T.read_logs(s.server, 'core', 'warn').slice(warned);
      expect(warns.map((l) => l.message.includes('user ID') || l.message.includes('reward notify ID'))).toEqual(bad.map(() => true));
      expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
      // The count is still 0: one failed callback reaches the limit 1.
      expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(403);
      expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(429);
      T.advance_time(s.server, MINUTE_MS);
      // No notify row: the same reward notify ID with a good user ID grants.
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(await balance(s.server, session.user_id, GEM())).toBe(10n);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('calls fetch_keys once within keyCacheMs and once within keyRefetchIntervalMs for unknown key IDs', async () => {
    const s = await start({ 'ads-reward.keyCacheMs': 600_000, 'ads-reward.keyRefetchIntervalMs': 60_000, 'ads-reward.callbackRateLimitPerMinute': 100 });
    try {
      const session = await user(s.server);
      const first = await notify_of(session, BASIC());
      expect((await signed(s, first, session.user_id)).status).toBe(200);
      expect(calls_of(s, 'fetch_keys')).toBe(1);
      const second = await notify_of(session, BASIC());
      expect((await signed(s, second, session.user_id)).status).toBe(200);
      expect((await callback(s.server, query_with_key(second, session.user_id, 7n))).status).toBe(403);
      expect((await callback(s.server, query_with_key(second, session.user_id, 8n))).status).toBe(403);
      expect(calls_of(s, 'fetch_keys')).toBe(1);

      T.advance_time(s.server, 60_000n);
      expect((await callback(s.server, query_with_key(second, session.user_id, 7n))).status).toBe(403);
      expect(calls_of(s, 'fetch_keys')).toBe(2);
      expect((await callback(s.server, query_with_key(second, session.user_id, 7n))).status).toBe(403);
      expect(calls_of(s, 'fetch_keys')).toBe(2);

      T.advance_time(s.server, 600_000n);
      const third = await notify_of(session, BASIC());
      expect((await signed(s, third, session.user_id)).status).toBe(200);
      expect(calls_of(s, 'fetch_keys')).toBe(3);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('calls fetch_keys once for concurrent callbacks waiting for the key list, and answers HTTP 503 when the fetch goes over keyFetchTimeoutMs', async () => {
    const s = await start({ 'ads-reward.keyFetchTimeoutMs': 1000 });
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      s.ads.set_failure('fetch_keys', 'timeout');
      const sent = await Promise.all(Array.from({ length: 5 }, () => signed(s, notify_id, session.user_id)));
      expect(sent.map((r) => r.status)).toEqual([503, 503, 503, 503, 503]);
      expect(calls_of(s, 'fetch_keys')).toBe(1);
      expect(key_fetch_errors(s)).toBe(1);
      expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(503);
      expect(calls_of(s, 'fetch_keys')).toBe(2);
      expect(key_fetch_errors(s)).toBe(2);

      s.ads.set_failure('fetch_keys', null);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(calls_of(s, 'fetch_keys')).toBe(3);
      expect(key_fetch_errors(s)).toBe(2);
      expect(await balance(s.server, session.user_id, GEM())).toBe(10n);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('answers HTTP 503 when fetching the key list fails', async () => {
    const s = await start();
    try {
      s.ads.set_failure('fetch_keys', 'communication_failure');
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      expect((await signed(s, notify_id, session.user_id)).status).toBe(503);
      expect(key_fetch_errors(s)).toBe(1);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(503);
      expect(calls_of(s, 'fetch_keys')).toBe(2);
      expect(key_fetch_errors(s)).toBe(2);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('grants a callback signed with a key that only the key list fetched again after keyRefetchIntervalMs has', async () => {
    const s = await start({ 'ads-reward.keyCacheMs': 600_000, 'ads-reward.keyRefetchIntervalMs': 60_000, 'ads-reward.callbackRateLimitPerMinute': 100 });
    try {
      const key_1 = new Uint8Array(randomBytes(32));
      s.ads.set_result('fetch_keys', [{ key_id: 1n, key: key_1 }]);
      const session = await user(s.server);
      expect((await signed(s, await notify_of(session, BASIC()), session.user_id)).status).toBe(200);
      expect(calls_of(s, 'fetch_keys')).toBe(1);

      s.ads.set_result('fetch_keys', [
        { key_id: 1n, key: key_1 },
        { key_id: 2n, key: new Uint8Array(randomBytes(32)) },
      ]);
      const notify_id = await notify_of(session, BASIC());
      expect((await signed(s, notify_id, session.user_id, 2n)).status).toBe(403);
      expect(calls_of(s, 'fetch_keys')).toBe(1);

      T.advance_time(s.server, 60_000n);
      expect((await signed(s, notify_id, session.user_id, 2n)).status).toBe(200);
      expect(calls_of(s, 'fetch_keys')).toBe(2);
      expect(await balance(s.server, session.user_id, GEM())).toBe(20n);
      expect((await signed(s, await notify_of(session, BASIC()), session.user_id, 1n)).status).toBe(200);
      expect(calls_of(s, 'fetch_keys')).toBe(2);
      expect(await balance(s.server, session.user_id, GEM())).toBe(30n);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('keeps the usable key list when fetching it again fails: a callback signed with a key of that list is still granted', async () => {
    const s = await start({ 'ads-reward.keyCacheMs': 600_000, 'ads-reward.keyRefetchIntervalMs': 60_000, 'ads-reward.callbackRateLimitPerMinute': 100 });
    try {
      const session = await user(s.server);
      expect((await signed(s, await notify_of(session, BASIC()), session.user_id)).status).toBe(200);
      expect(calls_of(s, 'fetch_keys')).toBe(1);

      s.ads.set_failure('fetch_keys', 'communication_failure');
      T.advance_time(s.server, 60_000n);
      const notify_id = await notify_of(session, BASIC());
      expect((await callback(s.server, query_with_key(notify_id, session.user_id, 7n))).status).toBe(403);
      expect(calls_of(s, 'fetch_keys')).toBe(2);
      expect(key_fetch_errors(s)).toBe(1);

      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(calls_of(s, 'fetch_keys')).toBe(2);
      expect(await balance(s.server, session.user_id, GEM())).toBe(20n);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('does not count callbacks answered HTTP 503: more than the limit of them do not make the next failed callback HTTP 429', async () => {
    const s = await start({ 'ads-reward.callbackRateLimitPerMinute': 1 });
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      s.ads.set_failure('fetch_keys', 'communication_failure');
      expect((await signed(s, notify_id, session.user_id)).status).toBe(503);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(503);

      s.ads.set_failure('fetch_keys', null);
      expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(403);
      expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(429);
      expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('answers HTTP 200 without a grant and with a warn log to a callback of a withdrawn user', async () => {
    const s = await start();
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      expect(error_of(await T.send(session, 'core/Withdraw', new CoreContract.WithdrawRequest()))).toBe(0);
      const warned = T.read_logs(s.server, 'core', 'warn').length;
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
      const warns = T.read_logs(s.server, 'core', 'warn').slice(warned);
      expect(warns.some((l) => l.message.includes(notify_id) && l.message.includes('withdrawn'))).toBe(true);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('answers HTTP 500 with an error log and no grant when the user transaction of the callback fails on the DB, and grants the same callback again', async () => {
    let fail_next = false;
    const s = await start(
      {},
      hooks({
        on_ad_rewarded: () => {
          if (fail_next) {
            fail_next = false;
            throw new DbError('lock', 'timeout', 'a lock wait went over its limit');
          }
        },
      }),
    );
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      fail_next = true;
      expect((await signed(s, notify_id, session.user_id)).status).toBe(500);
      expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
      expect(T.read_logs(s.server, 'error', 'error').some((l) => l.message.includes(notify_id) && l.message.includes('user transaction failed'))).toBe(true);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(await balance(s.server, session.user_id, GEM())).toBe(10n);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('answers HTTP 500 with an error log to a malformed or badly signed callback when the IP counter update fails on the DB', async () => {
    const s = await start({ 'storage.userLockWaitMs': 200 });
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      const errors = T.read_logs(s.server, 'error', 'error').length;
      const release = await block_ip_counter(s.server);
      try {
        expect((await callback(s.server, 'bad')).status).toBe(500);
        expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(500);
      } finally {
        await release();
      }
      const logged = T.read_logs(s.server, 'error', 'error').slice(errors);
      expect(logged.filter((l) => l.message === 'ad callback IP counter update failed')).toHaveLength(2);
      expect((await callback(s.server, 'bad')).status).toBe(400);
      expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(403);
    } finally {
      await T.stop_test_server(s.server);
      stop_all();
    }
  });

  it('answers HTTP 200 without a grant to a callback of a user that does not exist', async () => {
    const s = await start();
    try {
      expect((await signed(s, randomUUID(), 987_654_321n)).status).toBe(200);
      expect(T.read_logs(s.server, 'core', 'warn').length).toBeGreaterThanOrEqual(1);
    } finally {
      await T.stop_test_server(s.server);
    }
  });
});

describe('ads-reward ads-admob adapter', () => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const base64 = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const KEY_ID = 3335741209;

  /** An AdMob callback query of the reward notify ID and the user ID, signed with `text` or with the query of `text`. */
  function admob_query(custom_data: string, user_id: string, signed_text?: string): string {
    const text =
      `ad_network=5450213213286189855&ad_unit=1234567890&custom_data=${encodeURIComponent(custom_data)}&reward_amount=1&reward_item=coin` +
      `&timestamp=1507770365237823&transaction_id=18fa792de1bca816048293fc71035638&user_id=${user_id}`;
    const signature = sign('sha256', Buffer.from(signed_text ?? text, 'utf8'), { key: pair.privateKey, dsaEncoding: 'der' }).toString('base64url');
    return `${text}&signature=${signature}&key_id=${String(KEY_ID)}`;
  }

  it('grants an AdMob callback signed with a key of the key source, and answers HTTP 403 to another signature', async () => {
    const server = await T.start_test_server(T0, undefined, undefined, undefined, { ads: 'ads-admob' });
    try {
      T.set_key_source(server, 'ads', [{ keyId: KEY_ID, base64 }]);
      const session = await user(server);
      const notify_id = await notify_of(session, BASIC());
      expect((await callback(server, admob_query(notify_id, String(session.user_id), 'other'), 'admob')).status).toBe(403);
      expect((await callback(server, 'a=b')).status).toBe(404);
      expect((await callback(server, admob_query(notify_id, String(session.user_id)), 'admob')).status).toBe(200);
      expect(await balance(server, session.user_id, GEM())).toBe(10n);
      expect(error_of(await claim(session, notify_id))).toBe(0);
    } finally {
      await T.stop_test_server(server);
    }
  });

  it('answers HTTP 200 without a grant or a count to a signed AdMob callback whose user_id is x or whose custom_data is 36 × 가', async () => {
    const settings = { 'idempotency.maxNotifyIdBytes': 64, 'ads-reward.callbackRateLimitPerMinute': 1 };
    const server = await T.start_test_server(T0, undefined, undefined, undefined, { ads: 'ads-admob' }, settings);
    try {
      T.set_key_source(server, 'ads', [{ keyId: KEY_ID, base64 }]);
      const session = await user(server);
      const notify_id = await notify_of(session, BASIC());
      const warned = T.read_logs(server, 'core', 'warn').length;
      expect((await callback(server, admob_query(notify_id, 'x'), 'admob')).status).toBe(200);
      expect((await callback(server, admob_query('가'.repeat(36), String(session.user_id)), 'admob')).status).toBe(200);
      expect(T.read_logs(server, 'core', 'warn').slice(warned)).toHaveLength(2);
      expect(await balance(server, session.user_id, GEM())).toBe(0n);
      expect((await callback(server, admob_query(notify_id, String(session.user_id), 'other'), 'admob')).status).toBe(403);
      expect((await callback(server, admob_query(notify_id, String(session.user_id), 'other'), 'admob')).status).toBe(429);
    } finally {
      await T.stop_test_server(server);
    }
  });
});
