/** The module input of `create_loot_table`: its setting and its dependency modules. */
import { create_loot_table } from '../index.ts';

const modules = {
  storage: { random_weighted: () => 0 },
  'item-ledger': { amount_limit: () => 0n, read_amount: () => 0n, make_item_amount: () => undefined },
  logging: { write: () => undefined },
};

describe('create_loot_table', () => {
  test('loot-table.maxRollCount that is missing, under 1 or not an integer throws', () => {
    for (const value of [undefined, 0, -1, 1.5, '10', null]) {
      expect(() => create_loot_table({ settings: { 'loot-table.maxRollCount': value }, modules })).toThrow(/loot-table.maxRollCount/);
    }
  });

  test('a missing storage, item-ledger or logging module throws', () => {
    const settings = { 'loot-table.maxRollCount': 10 };
    const { storage, logging } = modules;
    const ledger = modules['item-ledger'];
    expect(() => create_loot_table({ settings, modules: { 'item-ledger': ledger, logging } })).toThrow(/storage/);
    expect(() => create_loot_table({ settings, modules: { storage, logging } })).toThrow(/item-ledger/);
    expect(() => create_loot_table({ settings, modules: { storage, 'item-ledger': ledger } })).toThrow(/logging/);
  });

  test('the lifecycle methods do nothing and start succeeds', () => {
    const loot = create_loot_table({ settings: { 'loot-table.maxRollCount': 10 }, modules });
    loot.begin_start();
    expect(loot.complete_start()).toBeNull();
    loot.stop();
  });
});
