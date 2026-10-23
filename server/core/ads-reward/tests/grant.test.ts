import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import {
  amounts,
  BASIC,
  balance,
  balance_entry,
  callback,
  CAPPED,
  CAPPED_PLACEMENT,
  claim,
  DAILY,
  DAY_MS,
  data,
  data_with_placements,
  drop_placements,
  entries,
  error_of,
  GEM,
  item,
  notify_of,
  placement,
  query_with_key,
  reward_count,
  signed,
  start,
  state,
  T,
  T0,
  user,
  type Started,
} from './helpers.ts';

const { CoreError, ItemChangeSource } = CoreContract;

describe('ads-reward grant', () => {
  let s: Started;

  beforeAll(async () => {
    s = await start();
  });

  afterAll(async () => {
    await T.stop_test_server(s.server);
  });

  it('BeginAdReward, the callback and ClaimAdReward grant the reward once with source AdReward', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, BASIC());
    expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
    const claimed = await claim(session, notify_id);
    expect(error_of(claimed)).toBe(0);
    expect(amounts(claimed.response?.items ?? [])).toEqual([[GEM(), 10n]]);
    const changes = claimed.envelope.item_changes.filter((c) => c.item_id === GEM());
    expect(changes.map((c) => [c.delta, c.source, c.ref])).toEqual([[10n, ItemChangeSource.ITEM_CHANGE_SOURCE_AD_REWARD, String(BASIC())]]);
    expect(balance_entry(claimed.envelope.pending_user_state, GEM())).toBe(10n);
    expect(await balance(s.server, session.user_id, GEM())).toBe(10n);
  });

  it('grants once when the callback of a reward notify ID comes twice', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, BASIC());
    expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
    expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
    expect(await balance(s.server, session.user_id, GEM())).toBe(10n);
    expect((await reward_count(s.server, session.user_id, BASIC()))?.count).toBe(1);
  });

  it('answers HTTP 403 to a wrong signature and does not grant', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, BASIC());
    const good = s.ads.sign_callback(notify_id, session.user_id, 1n);
    const flipped = `${good.slice(0, -1)}${good.endsWith('A') ? 'E' : 'A'}`;
    expect((await callback(s.server, flipped)).status).toBe(403);
    expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
    const logs = T.read_logs(s.server, 'security').filter((l) => l.reason === 'ad_callback_signature');
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(logs)).not.toContain(flipped);
  });

  it('grants the query of sign_callback, and answers HTTP 403 to another key and to a key ID not in the key list', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, BASIC());
    expect((await callback(s.server, query_with_key(notify_id, session.user_id, 1n))).status).toBe(403);
    expect((await callback(s.server, query_with_key(notify_id, session.user_id, 99n))).status).toBe(403);
    expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
    expect((await callback(s.server, s.ads.sign_callback(notify_id, session.user_id, 1n))).status).toBe(200);
    expect(await balance(s.server, session.user_id, GEM())).toBe(10n);
  });

  it('does not grant the callback of another user ticket, a Replaced ticket or an Expired ticket', async () => {
    const owner = await user(s.server);
    const other = await user(s.server);
    const owned = await notify_of(owner, BASIC());
    expect((await signed(s, owned, other.user_id)).status).toBe(200);
    expect(await balance(s.server, other.user_id, GEM())).toBe(0n);
    expect(await balance(s.server, owner.user_id, GEM())).toBe(0n);

    const replaced = await notify_of(owner, BASIC());
    await notify_of(owner, BASIC());
    expect((await signed(s, replaced, owner.user_id)).status).toBe(200);
    expect(await balance(s.server, owner.user_id, GEM())).toBe(0n);
    expect(error_of(await claim(owner, replaced))).toBe(CoreError.CORE_ERROR_AD_REWARD_NOT_FOUND);

    const unknown = await user(s.server);
    expect((await signed(s, randomUUID(), unknown.user_id)).status).toBe(200);
    const warns = T.read_logs(s.server, 'core', 'warn');
    expect(warns.length).toBeGreaterThanOrEqual(2);
  });

  it('does not grant the callback of an Expired ticket', async () => {
    const t = await start({ 'ads-reward.ticketTtlMs': 60_000 });
    try {
      const session = await user(t.server);
      const notify_id = await notify_of(session, BASIC());
      T.advance_time(t.server, 60_000n);
      expect((await signed(t, notify_id, session.user_id)).status).toBe(200);
      expect(await balance(t.server, session.user_id, GEM())).toBe(0n);
      expect(error_of(await claim(session, notify_id))).toBe(CoreError.CORE_ERROR_AD_REWARD_NOT_FOUND);
    } finally {
      await T.stop_test_server(t.server);
    }
  });

  it('grants by an [ad_reward_mail] mail when max_amount stops the grant, and ClaimAdReward returns an empty list and the mail', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, CAPPED_PLACEMENT());
    expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
    expect(await balance(s.server, session.user_id, CAPPED())).toBe(0n);
    const mails = await state(s.server, session.user_id, 'MailUserState');
    expect(mails).toHaveLength(1);
    const mail = mails[0]?.value as CoreContract.MailUserState;
    expect(mail.template_id).toBe(data.ReservedId.ad_reward_mail());
    expect(amounts(mail.attachments)).toEqual([[CAPPED(), 20n]]);
    const claimed = await claim(session, notify_id);
    expect(error_of(claimed)).toBe(0);
    expect(claimed.response?.items).toEqual([]);
    expect(claimed.envelope.item_mails.map((m) => [m.mail_id, m.source, m.ref, amounts(m.items)])).toEqual([
      [mail.id, ItemChangeSource.ITEM_CHANGE_SOURCE_AD_REWARD, String(CAPPED_PLACEMENT()), [[CAPPED(), 20n]]],
    ]);
    expect(entries(claimed.envelope.pending_user_state, 'MailUserState')).toHaveLength(1);
  });

  it('returns the granted list of the ticket on every ClaimAdReward', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, BASIC());
    await signed(s, notify_id, session.user_id);
    expect(amounts((await claim(session, notify_id)).response?.items ?? [])).toEqual([[GEM(), 10n]]);
    expect(amounts((await claim(session, notify_id)).response?.items ?? [])).toEqual([[GEM(), 10n]]);
  });

  it('sets reset_at of a Daily placement to get_next_reset(Daily, request time)', async () => {
    T.set_time(s.server, T0 + 5n * 3_600_000n);
    const session = await user(s.server);
    const notify_id = await notify_of(session, DAILY());
    await signed(s, notify_id, session.user_id);
    const count = await reward_count(s.server, session.user_id, DAILY());
    expect(count?.count).toBe(1);
    expect(count?.reset_at).toBe(T0 + DAY_MS);
  });

  it('stores the core analytics event core_ad_rewarded of a grant to a user who allows analytics', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, BASIC());
    await signed(s, notify_id, session.user_id);
    const listed = await T.send_admin(s.server, 'list_server_events', {
      user_id: String(session.user_id),
      name: 'core_ad_rewarded',
      from_at: String(T0 - DAY_MS),
      to_at: String(T0 + 10n * DAY_MS),
      limit: 10,
    });
    expect(listed.status).toBe(200);
    const rows = (listed.json as { entries: { name: string; params: string }[] }).entries;
    expect(rows).toHaveLength(1);
    const event = CoreContract.AnalyticsEvent.decode(new Uint8Array(Buffer.from(rows[0]?.params ?? '', 'base64')));
    expect(event?.params.map((p) => [p.key, p.int_value])).toEqual([['placement_id', BigInt(BASIC())]]);
  });
});

/** Rewarded placements after every ID value of the core test data. */
const GONE_ID = 900_011;
const BAD_REWARD_ID = 900_012;
/** An item ID value no `item` row has: `item-ledger` answers `UNKNOWN_ITEM`. */
const NO_ITEM = 900_013;

describe('ads-reward grant failures', () => {
  it('leaves the ticket Failed with an error log when its placement is no longer in ad_placement, and ClaimAdReward is INTERNAL', async () => {
    const folder = data_with_placements([placement({ id: GONE_ID, type: GameData.AdType.Rewarded, reward: [item(GEM(), 3n)] })]);
    const s = await start({}, undefined, folder);
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, GONE_ID);
      drop_placements(folder);
      await T.restart_test_server(s.server);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
      expect(await reward_count(s.server, session.user_id, GONE_ID)).toBeNull();
      const errors = T.read_logs(s.server, 'error', 'error');
      expect(errors.some((l) => l.message.includes(notify_id) && l.message.includes('not in ad_placement'))).toBe(true);
      expect(error_of(await claim(session, notify_id))).toBe(CoreError.CORE_ERROR_INTERNAL);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('leaves the ticket Failed with an error log when mailbox.grant_or_mail fails, and ClaimAdReward is INTERNAL', async () => {
    const folder = data_with_placements([placement({ id: BAD_REWARD_ID, type: GameData.AdType.Rewarded, reward: [item(NO_ITEM, 1n)] })]);
    expect(data.ItemTable.has_row(NO_ITEM)).toBe(false);
    const s = await start({}, undefined, folder);
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BAD_REWARD_ID);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(await reward_count(s.server, session.user_id, BAD_REWARD_ID)).toBeNull();
      const errors = T.read_logs(s.server, 'error', 'error');
      expect(errors.some((l) => l.message.includes(notify_id) && l.message.includes('grant_or_mail returned UNKNOWN_ITEM'))).toBe(true);
      expect(error_of(await claim(session, notify_id))).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(await reward_count(s.server, session.user_id, BAD_REWARD_ID)).toBeNull();
    } finally {
      await T.stop_test_server(s.server);
    }
  });
});
