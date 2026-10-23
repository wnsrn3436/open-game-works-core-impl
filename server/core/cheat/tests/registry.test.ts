import type * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import { is_offset_in_range } from '../dev/offset_table.ts';
import { create_cheat_registry, type CheatEntry, type CheatHandler } from '../dev/registry.ts';

const first = CoreCheatContract.RPCS[0];
if (first === undefined) throw new Error('base proto has no core cheat');
const base = first;

/** A `service Cheat` rpc list of the given cheat names. */
function game_rpcs(...names: string[]): CoreContract.RpcInfo[] {
  return names.map((name) => ({ ...base, name: `cheat/${name}` }));
}

const handler: CheatHandler = () => new CoreCheatContract.SetTimeOffsetResponse();
const core: CheatEntry[] = [{ name: 'SetTimeOffset', request_name: 'core/cheat/SetTimeOffset', core: true, rpc: base, handler }];

describe('cheat handler registry', () => {
  it('lists core cheats and the registered content cheats', () => {
    const registry = create_cheat_registry(game_rpcs('Grant', 'Reset'), core);
    registry.register('Reset', handler);
    registry.register('Grant', handler);
    expect(registry.close()).toBeNull();
    expect(registry.list().map((e) => [e.name, e.request_name, e.core])).toEqual([
      ['SetTimeOffset', 'core/cheat/SetTimeOffset', true],
      ['Grant', 'cheat/Grant', false],
      ['Reset', 'cheat/Reset', false],
    ]);
  });

  it('fails the server start when a service Cheat rpc has no handler', () => {
    const registry = create_cheat_registry(game_rpcs('Grant', 'Reset'), core);
    registry.register('Grant', handler);
    expect(registry.close()).toContain('Reset');
  });

  it('fails the server start for an unknown name, a second registration and a handler that is not a function', () => {
    const cases: [string, CheatHandler][][] = [
      [['Grant', handler], ['Nothing', handler]],
      [['Grant', handler], ['SetTimeOffset', handler]],
      [['Grant', handler], ['Grant', handler]],
      [['Grant', 'no' as unknown as CheatHandler]],
    ];
    for (const registrations of cases) {
      const registry = create_cheat_registry(game_rpcs('Grant'), core);
      for (const [name, h] of registrations) registry.register(name, h);
      expect(registry.close()).not.toBeNull();
    }
  });

  it('throws on a registration after the end of registration', () => {
    const registry = create_cheat_registry(game_rpcs(), core);
    expect(registry.close()).toBeNull();
    expect(() => {
      registry.register('Grant', handler);
    }).toThrow();
  });
});

describe('cheat time offset range', () => {
  const MAX = 1n << 63n;
  it('takes clock + offset from 0 to under 2^63', () => {
    expect(is_offset_in_range(1000n, -1000n)).toBe(true);
    expect(is_offset_in_range(1000n, -1001n)).toBe(false);
    expect(is_offset_in_range(1000n, MAX - 1001n)).toBe(true);
    expect(is_offset_in_range(1000n, MAX - 1000n)).toBe(false);
  });
});
