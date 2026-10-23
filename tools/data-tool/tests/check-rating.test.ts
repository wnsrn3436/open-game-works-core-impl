/** The data check of `rating` (`src/checks/rating.ts`): each rule of its spec `## data` makes an ERROR line. */
import { describe, expect, test } from 'vitest';
import { fixture, run, table } from './helpers.ts';

const RULE_COLUMNS = [
  'id|id(key)|All', 'initial_rating|long|All', 'min_rating|long|All', 'scale|long|Server', 'k_factor|int|Server',
  'placement_k_factor|int|Server', 'placement_matches|int|All', 'season_board|ref<ranking_board.id>?|All',
  'soft_reset_target|long|Server', 'soft_reset_permille|int|Server', 'reward_mail|ref<mail_template.id>?|Server',
  'reward_min_games|int|Server',
];
const TIER_COLUMNS = ['id|id(key)|All', 'rule|ref<rating_rule.id>|All', 'min_rating|long|All', 'season_reward|array<{item_id: ref<item.id>, amount: long}>|Server'];

/** A valid rule row; `over` replaces cells by column name. */
function rule(id: string, over: Record<string, string> = {}): string[] {
  const cells: Record<string, string> = {
    id, initial_rating: '1000', min_rating: '0', scale: '400', k_factor: '32', placement_k_factor: '64', placement_matches: '2',
    season_board: '[board]', soft_reset_target: '1000', soft_reset_permille: '500', reward_mail: '[mail]', reward_min_games: '1', ...over,
  };
  return RULE_COLUMNS.map((c) => cells[c.split('|')[0] as string] as string);
}

function check(rules: string[][], tiers: string[][], modules: string[] = ['rating']): string[] {
  const f = fixture({
    modules,
    files: {
      'data/tables/item.csv': table(['id|id(key)|All'], [['[gem]']]),
      'data/tables/mail_template.csv': table(['id|id(key)|All'], [['[mail]']]),
      'data/tables/ranking_board.csv': table(['id|id(key)|All'], [['[board]']]),
      'data/tables/rating_rule.csv': table(RULE_COLUMNS, rules),
      'data/tables/rating_tier.csv': table(TIER_COLUMNS, tiers),
    },
  });
  const r = run(f);
  return r.stdout.filter((l) => l.includes(' ERROR ')).map((l) => l.split(' ').slice(0, 3).join(' '));
}

describe('rating data check', () => {
  test('valid rows make no line', () => {
    expect(check([rule('[r]'), rule('[s]', { season_board: 'null', reward_mail: 'null', reward_min_games: '0', soft_reset_permille: '1000' })], [
      ['[t1]', '[r]', '0', '[gem] 10'], ['[t2]', '[r]', '1100', ''], ['[t3]', '[s]', '0', ''],
    ])).toEqual([]);
  });

  test('a rule value below its lower bound is out_of_range', () => {
    expect(check([
      rule('[a]', { scale: '0' }), rule('[b]', { k_factor: '-1' }), rule('[c]', { placement_k_factor: '-1' }),
      rule('[d]', { placement_matches: '-1' }), rule('[e]', { soft_reset_permille: '-1' }), rule('[f]', { reward_min_games: '-1' }),
    ], [])).toEqual([
      'data/tables/rating_rule.csv:5:4 ERROR out_of_range', 'data/tables/rating_rule.csv:6:5 ERROR out_of_range',
      'data/tables/rating_rule.csv:7:6 ERROR out_of_range', 'data/tables/rating_rule.csv:8:7 ERROR out_of_range',
      'data/tables/rating_rule.csv:9:10 ERROR out_of_range', 'data/tables/rating_rule.csv:10:12 ERROR out_of_range',
    ]);
  });

  test('soft_reset_permille above 1000 is out_of_range', () => {
    expect(check([rule('[a]', { soft_reset_permille: '1001' })], [])).toEqual(['data/tables/rating_rule.csv:5:10 ERROR out_of_range']);
  });

  test('min_rating above initial_rating or soft_reset_target is out_of_range', () => {
    expect(check([rule('[a]', { min_rating: '1001', soft_reset_target: '2000' }), rule('[b]', { min_rating: '900', soft_reset_target: '800' })], [])).toEqual([
      'data/tables/rating_rule.csv:5:3 ERROR out_of_range', 'data/tables/rating_rule.csv:6:3 ERROR out_of_range',
    ]);
  });

  test('two tiers of the same rule with the same min_rating are duplicate; other rules may share it', () => {
    expect(check([rule('[a]'), rule('[b]')], [
      ['[t1]', '[a]', '100', ''], ['[t2]', '[a]', '100', ''], ['[t3]', '[b]', '100', ''],
    ])).toEqual(['data/tables/rating_tier.csv:6:3 ERROR duplicate']);
  });

  test('reward_min_games 0 with a tier season reward is out_of_range; without one it is valid', () => {
    expect(check([rule('[a]', { reward_min_games: '0' }), rule('[b]', { reward_min_games: '0' })], [
      ['[t1]', '[a]', '0', '[gem] 1'], ['[t2]', '[b]', '0', ''],
    ])).toEqual(['data/tables/rating_rule.csv:5:12 ERROR out_of_range']);
  });

  test('a null season_board or reward_mail with a tier season reward is empty_required', () => {
    expect(check([rule('[a]', { season_board: 'null' }), rule('[b]', { reward_mail: 'null' })], [
      ['[t1]', '[a]', '0', '[gem] 1'], ['[t2]', '[b]', '0', '[gem] 1'],
    ])).toEqual(['data/tables/rating_rule.csv:5:8 ERROR empty_required', 'data/tables/rating_rule.csv:6:11 ERROR empty_required']);
  });

  test('the check runs only when rating is a module of the game', () => {
    expect(check([rule('[a]', { scale: '0' })], [], [])).toEqual([]);
  });
});
