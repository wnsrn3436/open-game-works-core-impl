import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { send } from '../../testing/dev/index.ts';
import type { MatchOutcome } from '../index.ts';
import {
  close_season,
  error_logs,
  expected_tier,
  in_tx,
  mails,
  match,
  rating_row,
  refresh,
  season_of,
  set_rating,
  start,
  user,
  type Kit,
  type TestSession,
} from './helpers.ts';

const BASIC = '[rating_rule_basic]';
const BOARD = '[board_rating_weekly]';
const SEASONLESS = '[rating_rule_seasonless]';

/** Sends `RefreshRating` and returns the error code of its envelope (0 when none). */
async function refresh_code(session: TestSession): Promise<number> {
  const { envelope } = await send(session, 'core/RefreshRating', new CoreContract.RefreshRatingRequest());
  return envelope.error?.code ?? 0;
}

/** Wins `count` 1 vs 1 matches of equal record ratings 1000 on the basic rule. */
async function win(kit: Kit, a: TestSession, b: TestSession, count: number): Promise<void> {
  const record = match(kit, '[mode_rating_duel]', [a.user_id, b.user_id], [1000n, 1000n]);
  for (let i = 0; i < count; i++) {
    const outcome: MatchOutcome = await in_tx(kit, a.user_id, (ctx) => kit.core.rating.apply_match_outcome(ctx, record, 0, [0, 1]));
    expect(outcome.result).toBe('OK');
  }
}

/** The rating after the soft reset of a rating of the basic rule. */
async function soft_reset(kit: Kit, user_id: bigint, rating: bigint): Promise<bigint> {
  const rule = kit.data.RatingRuleTable.get_row(kit.id(BASIC));
  const scaled = await in_tx(kit, user_id, () => kit.core.validation.apply_permille(rating - rule.soft_reset_target, BigInt(rule.soft_reset_permille)));
  expect(scaled.success).toBe(true);
  const reset = rule.soft_reset_target + scaled.value;
  return reset < rule.min_rating ? rule.min_rating : reset;
}

/** The `mailbox_once_key` rows that hold the value, whatever their column names. */
function once_key_rows(kit: Kit, value: string): unknown[] {
  return kit.core.storage.read_db().query('SELECT * FROM mailbox_once_key', []).filter((row) => Object.values(row as object).includes(value));
}

function expect_reward_mail(kit: Kit, mail: CoreContract.MailUserState | undefined, season: bigint, tier: string): void {
  const reward = kit.data.RatingTierTable.get_row(kit.id(tier)).season_reward;
  expect(mail).toBeDefined();
  expect(mail?.template_id).toBe(kit.id('[mail_rating_season]'));
  expect(mail?.args.map((arg) => ({ name: arg.name, kind: arg.kind, int_value: arg.int_value }))).toEqual([
    { name: 'season', kind: CoreContract.MailArgKind.MAIL_ARG_KIND_INT, int_value: season },
  ]);
  expect(mail?.attachments.map((item) => [item.item_id, item.amount, item.big_amount])).toEqual(reward.map((item) => [item.item_id, item.amount, item.big_amount]));
}

describe('season settle', () => {
  it('RefreshRating after close_season_now writes the settle once and mails the tier season reward of the last season once', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-season-a');
    const b = await user(kit, 'rating-season-b');
    const rule = kit.id(BASIC);
    const last = await season_of(kit, a.user_id, BOARD);
    await win(kit, a, b, 2);
    const played = await rating_row(kit, a.user_id, rule);
    expect(played).toMatchObject({ rating: 1064n, season: last, season_games: 2, total_games: 2, tier_id: kit.id('[rating_tier_bronze]') });
    await close_season(kit, BOARD, a.user_id);
    const now = await season_of(kit, a.user_id, BOARD);
    expect(now).toBe(last + 1n);

    await refresh(a);
    const reset = await soft_reset(kit, a.user_id, 1064n);
    expect(reset).toBe(1032n);
    const settled = await rating_row(kit, a.user_id, rule);
    expect(settled).toMatchObject({ rating: reset, season: now, season_games: 0, total_games: 2, tier_id: expected_tier(kit, BASIC, reset) });
    const sent = await mails(kit, a.user_id);
    expect(sent.length).toBe(1);
    expect_reward_mail(kit, sent[0], last, '[rating_tier_bronze]');
    expect(once_key_rows(kit, `rating:${String(rule)}:${String(last)}`).length).toBe(1);

    await refresh(a);
    expect(await rating_row(kit, a.user_id, rule)).toEqual(settled);
    expect(await mails(kit, a.user_id)).toEqual(sent);
  });

  it('settles once and mails once after two season changes, with the season of the row before the settle in the mail and its once_key', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-twice-a');
    const b = await user(kit, 'rating-twice-b');
    const rule = kit.id(BASIC);
    await set_rating(kit, a.user_id, BASIC, 1300n - 64n);
    await win(kit, a, b, 2);
    const played = await rating_row(kit, a.user_id, rule);
    expect(played?.tier_id).toBe(kit.id('[rating_tier_gold]'));
    const last = played?.season ?? -1n;
    await close_season(kit, BOARD, a.user_id);
    await close_season(kit, BOARD, a.user_id);
    const now = await season_of(kit, a.user_id, BOARD);
    expect(now).toBe(last + 2n);

    await refresh(a);
    const reset = await soft_reset(kit, a.user_id, played?.rating ?? 0n);
    expect(await rating_row(kit, a.user_id, rule)).toMatchObject({ rating: reset, season: now, season_games: 0 });
    const sent = await mails(kit, a.user_id);
    expect(sent.length).toBe(1);
    expect_reward_mail(kit, sent[0], last, '[rating_tier_gold]');
    expect(once_key_rows(kit, `rating:${String(rule)}:${String(last)}`).length).toBe(1);
    expect(once_key_rows(kit, `rating:${String(rule)}:${String(last + 1n)}`).length).toBe(0);
  });

  it('get_rating after a season change gives the settled values and leaves the row and the mails as they were', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-view-a');
    const b = await user(kit, 'rating-view-b');
    const rule = kit.id(BASIC);
    await win(kit, a, b, 2);
    const played = await rating_row(kit, a.user_id, rule);
    await close_season(kit, BOARD, a.user_id);
    const now = await season_of(kit, a.user_id, BOARD);
    const view = await in_tx(kit, a.user_id, (ctx) => kit.core.rating.get_rating(ctx, rule));
    const reset = await soft_reset(kit, a.user_id, 1064n);
    expect(view).toEqual({ rating: reset, tier_id: expected_tier(kit, BASIC, reset), season: now, season_games: 0, placement: true });
    expect(await rating_row(kit, a.user_id, rule)).toEqual(played);
    expect(await mails(kit, a.user_id)).toEqual([]);
  });

  it('mails no reward when season_games before the settle is below reward_min_games, mails it when equal, and mails none for a row made without a match', async () => {
    const kit = await start();
    const [a, b, c, z] = await Promise.all(['rating-min-games-a', 'rating-min-games-b', 'rating-min-games-c', 'rating-min-games-z'].map((name) => user(kit, name)));
    if (!a || !b || !c || !z) throw new Error('login');
    const rule = kit.data.RatingRuleTable.get_row(kit.id(BASIC));
    expect(rule.reward_min_games).toBe(2);
    await win(kit, a, z, rule.reward_min_games - 1);
    await win(kit, b, z, rule.reward_min_games);
    await set_rating(kit, c.user_id, BASIC, 1300n);
    const before_c = await rating_row(kit, c.user_id, rule.id);
    expect(before_c?.season_games).toBe(0);
    await close_season(kit, BOARD, a.user_id);
    const now = await season_of(kit, a.user_id, BOARD);
    for (const session of [a, b, c]) await refresh(session);
    for (const session of [a, b, c]) expect((await rating_row(kit, session.user_id, rule.id))?.season).toBe(now);
    expect(await mails(kit, a.user_id)).toEqual([]);
    expect((await mails(kit, b.user_id)).length).toBe(1);
    expect(await mails(kit, c.user_id)).toEqual([]);
    expect((await rating_row(kit, c.user_id, rule.id))?.rating).toBe(await soft_reset(kit, c.user_id, 1300n));
  });

  it('apply_match_outcome after a season change writes the settled row with Δ and season_games 1, and mails the reward of the last season once', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-apply-settle-a');
    const b = await user(kit, 'rating-apply-settle-b');
    const rule = kit.id(BASIC);
    const last = await season_of(kit, a.user_id, BOARD);
    await win(kit, a, b, 2);
    expect(await rating_row(kit, a.user_id, rule)).toMatchObject({ rating: 1064n, season: last, season_games: 2, total_games: 2 });
    await close_season(kit, BOARD, a.user_id);
    const now = await season_of(kit, a.user_id, BOARD);

    const record = match(kit, '[mode_rating_duel]', [a.user_id, b.user_id], [1000n, 1000n]);
    const outcome: MatchOutcome = await in_tx(kit, a.user_id, (ctx) => kit.core.rating.apply_match_outcome(ctx, record, 0, [0, 1]));
    const reset = await soft_reset(kit, a.user_id, 1064n);
    expect(reset).toBe(1032n);
    // season_games 0 < placement_matches: K = placement_k_factor 64, Δ = floor_div(2 × 64 × 500 + 1000, 2000) = 32.
    expect(outcome).toEqual({
      result: 'OK',
      change: { before: reset, after: reset + 32n, tier_before: expected_tier(kit, BASIC, reset), tier_after: expected_tier(kit, BASIC, reset + 32n) },
    });
    expect(await rating_row(kit, a.user_id, rule)).toMatchObject({ rating: reset + 32n, season: now, season_games: 1, total_games: 3, tier_id: expected_tier(kit, BASIC, reset + 32n) });
    const sent = await mails(kit, a.user_id);
    expect(sent.length).toBe(1);
    expect_reward_mail(kit, sent[0], last, '[rating_tier_bronze]');
    expect(once_key_rows(kit, `rating:${String(rule)}:${String(last)}`).length).toBe(1);

    await in_tx(kit, a.user_id, (ctx) => kit.core.rating.apply_match_outcome(ctx, record, 0, [0, 1]));
    expect(await mails(kit, a.user_id)).toEqual(sent);
  });

  it('set_rating after a season change writes that rating on the settled row and mails the reward of the last season', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-set-settle-a');
    const b = await user(kit, 'rating-set-settle-b');
    const rule = kit.id(BASIC);
    const last = await season_of(kit, a.user_id, BOARD);
    await win(kit, a, b, 2);
    await close_season(kit, BOARD, a.user_id);
    const now = await season_of(kit, a.user_id, BOARD);

    await set_rating(kit, a.user_id, BASIC, 1300n);
    expect(await rating_row(kit, a.user_id, rule)).toMatchObject({ rating: 1300n, season: now, season_games: 0, total_games: 2, tier_id: kit.id('[rating_tier_gold]') });
    const sent = await mails(kit, a.user_id);
    expect(sent.length).toBe(1);
    expect_reward_mail(kit, sent[0], last, '[rating_tier_bronze]');
  });

  it('RefreshRating skips a row whose rule is not in rating_rule and settles the other rows', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-unknown-rule-a');
    const b = await user(kit, 'rating-unknown-rule-b');
    const rule = kit.id(BASIC);
    await win(kit, a, b, 2);
    const unknown = new CoreContract.RatingUserState();
    unknown.id = 987_654n;
    unknown.rating = 777n;
    unknown.tier_id = 0;
    unknown.season = 0n;
    unknown.season_games = 3;
    unknown.total_games = 9;
    await in_tx(kit, a.user_id, (ctx) => {
      kit.core.storage.put_core_state(ctx, unknown);
    });
    const stored = await rating_row(kit, a.user_id, 987_654);
    expect(stored).toMatchObject({ rating: 777n, season: 0n, season_games: 3, total_games: 9 });
    await close_season(kit, BOARD, a.user_id);
    const now = await season_of(kit, a.user_id, BOARD);

    await refresh(a);
    expect(await rating_row(kit, a.user_id, 987_654)).toEqual(stored);
    expect(await rating_row(kit, a.user_id, rule)).toMatchObject({ rating: await soft_reset(kit, a.user_id, 1064n), season: now, season_games: 0 });
    expect((await mails(kit, a.user_id)).length).toBe(1);
  });

  it('has no settle for a rule whose season_board is null', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-no-season-a');
    const rule = kit.id(SEASONLESS);
    await set_rating(kit, a.user_id, SEASONLESS, 1234n);
    const before = await rating_row(kit, a.user_id, rule);
    expect(before).toMatchObject({ rating: 1234n, season: 0n });
    await close_season(kit, BOARD, a.user_id);
    await refresh(a);
    expect(await rating_row(kit, a.user_id, rule)).toEqual(before);
    expect(await in_tx(kit, a.user_id, (ctx) => kit.core.rating.get_rating(ctx, rule))).toMatchObject({ rating: 1234n, season: 0n });
    expect(await mails(kit, a.user_id)).toEqual([]);
  });

  it('has no settle for a row of a rule whose season_board is null even when the row holds a season other than 0', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-no-season-past-a');
    const rule = kit.id(SEASONLESS);
    const stored = new CoreContract.RatingUserState();
    stored.id = BigInt(rule);
    stored.rating = 1234n;
    stored.tier_id = kit.id('[rating_tier_plain]');
    stored.season = 5n;
    stored.season_games = 3;
    stored.total_games = 7;
    await in_tx(kit, a.user_id, (ctx) => {
      kit.core.storage.put_core_state(ctx, stored);
    });
    const before = await rating_row(kit, a.user_id, rule);
    expect(before).toMatchObject({ rating: 1234n, season: 5n, season_games: 3, total_games: 7 });

    expect(await in_tx(kit, a.user_id, (ctx) => kit.core.rating.get_rating(ctx, rule))).toMatchObject({ rating: 1234n, season_games: 3 });
    await refresh(a);
    expect(await rating_row(kit, a.user_id, rule)).toEqual(before);
    expect(await mails(kit, a.user_id)).toEqual([]);
  });

  it('counts ALREADY_SENT of the season reward mail as success: RefreshRating writes the settle and sends no second mail', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-already-sent-a');
    const b = await user(kit, 'rating-already-sent-b');
    const rule = kit.id(BASIC);
    const last = await season_of(kit, a.user_id, BOARD);
    await win(kit, a, b, 2);
    const once_key = `rating:${String(rule)}:${String(last)}`;
    const first = await in_tx(kit, a.user_id, (ctx) =>
      kit.core.mailbox.send_mail(ctx, {
        template_id: kit.id('[mail_rating_season]'),
        args: [{ name: 'season', int_value: last }],
        attachments: [],
        extra_id: 0,
        expire_ms: 0n,
        no_expiry: false,
        once_key,
      }),
    );
    expect(first.result).toBe('OK');
    const sent = await mails(kit, a.user_id);
    expect(sent.length).toBe(1);
    expect(sent[0]?.attachments).toEqual([]);
    await close_season(kit, BOARD, a.user_id);
    const now = await season_of(kit, a.user_id, BOARD);

    expect(await refresh_code(a)).toBe(0);
    expect(await rating_row(kit, a.user_id, rule)).toMatchObject({ rating: 1032n, season: now, season_games: 0, total_games: 2 });
    expect(await mails(kit, a.user_id)).toEqual(sent);
    expect(once_key_rows(kit, once_key).length).toBe(1);
  });

  it('fails RefreshRating with INTERNAL and leaves the row unsettled when the season reward send_mail returns INVALID_INPUT', async () => {
    // `mailbox.maxArgs` 0 makes the one `season` arg of the reward mail over the limit, so `send_mail` returns INVALID_INPUT.
    const kit = await start(undefined, { 'mailbox.maxArgs': 0 });
    const a = await user(kit, 'rating-mail-invalid-a');
    const b = await user(kit, 'rating-mail-invalid-b');
    const rule = kit.id(BASIC);
    await win(kit, a, b, 2);
    const played = await rating_row(kit, a.user_id, rule);
    expect(played).toMatchObject({ rating: 1064n, season_games: 2 });
    await close_season(kit, BOARD, a.user_id);

    expect(await refresh_code(a)).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
    expect(await rating_row(kit, a.user_id, rule)).toEqual(played);
    expect(await mails(kit, a.user_id)).toEqual([]);
    expect(error_logs(kit, 'send_mail input is invalid').length).toBeGreaterThan(0);
  });

  it('fails RefreshRating with INTERNAL and leaves the row as it was when the soft reset overflows apply_permille', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-overflow-a');
    const rule = kit.id(BASIC);
    // (2^60 − 1000) × 500 is over int64.
    await set_rating(kit, a.user_id, BASIC, 2n ** 60n);
    const before = await rating_row(kit, a.user_id, rule);
    expect(before?.rating).toBe(2n ** 60n);
    await close_season(kit, BOARD, a.user_id);

    expect(await refresh_code(a)).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
    expect(await rating_row(kit, a.user_id, rule)).toEqual(before);
    expect(await mails(kit, a.user_id)).toEqual([]);
  });

  it('clamps the soft reset rating to min_rating', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-reset-clamp-a');
    const rule = kit.id(BASIC);
    // 1000 + floor_div((−3000 − 1000) × 500, 1000) = −1000, below min_rating 0.
    await set_rating(kit, a.user_id, BASIC, -3000n);
    await close_season(kit, BOARD, a.user_id);
    const now = await season_of(kit, a.user_id, BOARD);

    await refresh(a);
    expect(await rating_row(kit, a.user_id, rule)).toMatchObject({ rating: 0n, season: now, season_games: 0, tier_id: kit.id('[rating_tier_bronze]') });
  });

  it('mails no season reward when the past season has no tier, even with reward_min_games matches', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-no-tier-a');
    const b = await user(kit, 'rating-no-tier-b');
    const rule = kit.id(BASIC);
    await win(kit, a, b, 2);
    // set_rating in the same season keeps season_games 2 and gives a rating below every tier of the rule.
    await set_rating(kit, a.user_id, BASIC, -3000n);
    expect(await rating_row(kit, a.user_id, rule)).toMatchObject({ rating: -3000n, season_games: 2, tier_id: 0 });
    await close_season(kit, BOARD, a.user_id);
    const now = await season_of(kit, a.user_id, BOARD);

    expect(await refresh_code(a)).toBe(0);
    expect(await rating_row(kit, a.user_id, rule)).toMatchObject({ rating: 0n, season: now, season_games: 0, total_games: 2 });
    expect(await mails(kit, a.user_id)).toEqual([]);
  });
});
