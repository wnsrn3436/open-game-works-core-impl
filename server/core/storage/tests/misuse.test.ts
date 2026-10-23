import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { canonical_json, NO_ACCESS_TOKEN_RPC } from '../index.ts';
import type { RequestCtx } from '../request_ctx.ts';
import { core_settings, instance, new_user, raw_rows, request, stop_all } from './helpers.ts';
import { boss, BossGameState, deck, DeckUserState, profile, ProfileUserState, quest, QuestUserState, wallet, WalletServerState } from './kinds.ts';

afterEach(() => {
  stop_all();
});

class NotAKind {
  encode(): Uint8Array {
    return new Uint8Array(0);
  }
}

function balance(id: bigint): CoreContract.ItemBalanceUserState {
  const b = new CoreContract.ItemBalanceUserState();
  b.id = id;
  b.amount = 5n;
  return b;
}

describe('misuse', () => {
  it('throws for each kind of misuse, and the request that hits it writes nothing', async () => {
    const max_public = Number(core_settings()['storage.maxPublicReadCount']);
    const max_list = Number(core_settings()['storage.maxGameStateList']);
    const max_payload = Number(core_settings()['storage.userChangeMaxBytes']);
    const { storage } = await instance({
      register: (s) => {
        s.content.register_user_change('gift', () => 'pass', () => undefined);
      },
    });
    const user = await new_user(storage);
    const other = await new_user(storage);
    const misuses: [string, (ctx: RequestCtx) => unknown][] = [
      ['unknown kind', (ctx) => {
        storage.get_state(ctx, NotAKind as never, 0n);
      }],
      ['unknown kind value', (ctx) => {
        storage.put_state(ctx, new NotAKind());
      }],
      ['negative item ID of a list kind', (ctx) => {
        storage.put_state(ctx, quest(-1n, 1n));
      }],
      ['negative item ID read', (ctx) => {
        storage.get_state(ctx, QuestUserState, -1n);
      }],
      ['nonzero item ID of a single kind', (ctx) => {
        storage.get_state(ctx, ProfileUserState, 1n);
      }],
      ['delete nonzero item ID of a single kind', (ctx) => {
        storage.delete_state(ctx, WalletServerState, 2n);
      }],
      ['not a kind message', (ctx) => {
        storage.put_state(ctx, { encode: () => new Uint8Array(0) });
      }],
      ['put_state of a core kind', (ctx) => {
        storage.put_state(ctx, balance(1n));
      }],
      ['delete_state of a core kind', (ctx) => {
        storage.delete_state(ctx, CoreContract.ItemBalanceUserState, 1n);
      }],
      ['put_core_state of a non-core kind', (ctx) => {
        storage.put_core_state(ctx, quest(1n, 1n));
      }],
      ['delete_core_state of a non-core kind', (ctx) => {
        storage.delete_core_state(ctx, QuestUserState, 1n);
      }],
      ['write inside run_read_only', (ctx) => {
        storage.run_read_only(ctx, () => {
          storage.put_state(ctx, quest(1n, 1n));
        });
      }],
      ['invalid ctx', () => {
        storage.get_state({} as RequestCtx, QuestUserState, 1n);
      }],
      ['read_public_state of a kind that is not public', (ctx) => {
        storage.read_public_state(ctx, [other], QuestUserState);
      }],
      ['read_public_state over the limit', (ctx) => {
        storage.read_public_state(ctx, Array.from({ length: max_public + 1 }, (_, i) => BigInt(i + 1)), ProfileUserState);
      }],
      ['negative game state key', (ctx) => {
        storage.get_game_state(ctx, BossGameState, -1n);
      }],
      ['negative game state key put', (ctx) => {
        storage.put_game_state(ctx, boss(-1n, 1n), 0n);
      }],
      ['list_game_state maximum below 1', (ctx) => {
        storage.list_game_state(ctx, BossGameState, 0n, 0);
      }],
      ['list_game_state maximum over the limit', (ctx) => {
        storage.list_game_state(ctx, BossGameState, 0n, max_list + 1);
      }],
      ['content lock_game_row of a table other than game_state', (ctx) => {
        storage.content.lock_game_row(ctx, 'user_state', [1n]);
      }],
      ['content lock_game_row of an unknown table', (ctx) => {
        storage.content.lock_game_row(ctx, 'no_such_table', [1n]);
      }],
      ['core module lock_game_row of game_state', (ctx) => {
        storage.lock_game_row(ctx, 'game_state', [BossGameState, 0n]);
      }],
      ['core module lock_game_row of a base table', (ctx) => {
        storage.lock_game_row(ctx, 'user_change', [1n]);
      }],
      ['user change not registered', (ctx) => {
        storage.send_user_change(ctx, other, 'unknown_gift', new Uint8Array(1));
      }],
      ['user change target 0', (ctx) => {
        storage.send_user_change(ctx, 0n, 'gift', new Uint8Array(1));
      }],
      ['user change to self', (ctx) => {
        storage.send_user_change(ctx, user, 'gift', new Uint8Array(1));
      }],
      ['user change payload over the limit', (ctx) => {
        storage.send_user_change(ctx, other, 'gift', new Uint8Array(max_payload + 1));
      }],
    ];
    for (const [name, misuse] of misuses) {
      const outcome = request(storage, user, (ctx) => {
        storage.put_state(ctx, quest(100n, 1n));
        misuse(ctx);
        return 'no throw';
      });
      await expect(outcome, name).rejects.toThrow();
    }
    for (const table of ['user_state', 'server_state', 'pending_delta']) expect(raw_rows(storage, table, user)).toEqual([]);
    expect(storage.read_db().query('SELECT change_id FROM user_change')).toEqual([]);
  });

  it('accepts the misuse-free forms of the same calls', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const ok = await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(0n, 1n));
      storage.put_state(ctx, profile(1n));
      storage.put_state(ctx, deck(1n, 1n));
      storage.put_state(ctx, wallet(1n));
      storage.put_core_state(ctx, balance(3n));
      storage.put_game_state(ctx, boss(0n, 1n), 0n);
      storage.content.lock_game_row(ctx, 'game_state', [BossGameState, 0n]);
      return { read: storage.list_game_state(ctx, BossGameState, -1n, 1).length + storage.list_state(ctx, DeckUserState).length };
    });
    expect(ok).toEqual({ read: 2 });
  });
});

describe('core kind owner rule', () => {
  it('refuses a core kind write through put_state and a non-core kind write through put_core_state', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const outcome = await request(storage, user, (ctx) => {
      const tries = [
        () => {
          storage.put_state(ctx, balance(1n));
        },
        () => {
          storage.put_core_state(ctx, quest(1n, 1n));
        },
        () => {
          storage.put_core_state(ctx, wallet(1n));
        },
      ];
      const results = tries.map((t) => {
        try {
          t();
          return 'written';
        } catch {
          return 'refused';
        }
      });
      storage.put_core_state(ctx, balance(2n));
      return [...results, (storage.get_state(ctx, CoreContract.ItemBalanceUserState, 2n) as CoreContract.ItemBalanceUserState).amount];
    });
    expect(outcome).toEqual(['refused', 'refused', 'refused', 5n]);
  });

  it('gives content register(core) a storage of only the operations whose caller includes content code', async () => {
    const { storage } = await instance();
    const content = storage.content as unknown as Record<string, unknown>;
    expect(Object.keys(content).sort()).toEqual(
      [
        'get_state',
        'list_state',
        'put_state',
        'delete_state',
        'read_public_state',
        'get_game_state',
        'list_game_state',
        'put_game_state',
        'delete_game_state',
        'lock_game_row',
        'send_user_change',
        'register_user_change',
        'random_u32',
        'random_int',
        'random_weighted',
        'random_shuffle',
        'create_random',
        'make_purpose_seed',
      ].sort(),
    );
    for (const name of Object.keys(content)) expect(typeof content[name], name).toBe('function');
    for (const name of ['put_core_state', 'delete_core_state', 'db', 'read_db', 'run_user_transaction', 'run_request_transaction', 'run_game_transaction', 'create_user', 'delete_user', 'replace_user_rows', 'add_item_change', 'take_response_delta', 'with_hook_change_source', 'after_commit', 'on_commit', 'register_table']) {
      expect(name in content, name).toBe(false);
    }
    const owner_put: unknown = Reflect.get(storage, 'put_core_state');
    expect(() => {
      content.put_core_state = () => undefined;
    }).toThrow(TypeError);
    expect(Reflect.get(storage, 'put_core_state')).toBe(owner_put);
    const user = await new_user(storage);
    const outcome = await request(storage, user, (ctx) => {
      storage.content.put_state(ctx, quest(1n, 2n));
      return (storage.content.get_state(ctx, QuestUserState, 1n) as QuestUserState).progress;
    });
    expect(outcome).toBe(2n);
  });

  it('has canonical_json on the module object and not on content, and the entry file exports NO_ACCESS_TOKEN_RPC', async () => {
    const { storage } = await instance();
    expect(storage.canonical_json({ b: 1n, a: [true, null] })).toBe('{"a":[true,null],"b":1}');
    expect(Reflect.get(storage, 'canonical_json')).toBe(canonical_json);
    const content = storage.content as unknown as Record<string, unknown>;
    expect(content.canonical_json).toBeUndefined();
    expect('canonical_json' in content).toBe(false);
    expect([...NO_ACCESS_TOKEN_RPC].sort()).toEqual(['core/AutoLogin', 'core/GetNotices', 'core/GetTerms', 'core/Login', 'core/RefreshToken', 'core/cheat/DevLogin']);
  });

  it('canonical_json writes plain objects, arrays, bytes and bigint, and throws for a non-finite number and every value with no JSON form', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.z = 1;
    bare.a = 'x';
    expect(canonical_json({ b: [1n, Uint8Array.from([255])], a: { d: undefined, c: false }, é: null })).toBe('{"a":{"c":false},"b":[1,"/w=="],"é":null}');
    expect(canonical_json(bare)).toBe('{"a":"x","z":1}');
    class Point {
      x = 1;
    }
    const holed: unknown[] = [1];
    holed[2] = 2;
    const no_form: [string, unknown][] = [
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity in an object', { n: Number.NEGATIVE_INFINITY }],
      ['undefined', undefined],
      ['undefined in an array', [1, undefined]],
      ['a hole in an array', holed],
      ['a function', () => 1],
      ['a symbol', Symbol('s')],
      ['a Map', new Map([['a', 1]])],
      ['a Set in an object', { a: new Set([1]) }],
      ['a Date', new Date(0)],
      ['a class instance', new Point()],
      ['a RegExp in an array', [/a/]],
    ];
    for (const [name, value] of no_form) expect(() => canonical_json(value), name).toThrow(TypeError);
  });

  it('check_hook_output returns pass and 1000, throws with the hook name for 999, 1.5, null and ok, and is not on content', async () => {
    const { storage } = await instance();
    expect(storage.check_hook_output('test.hook', 'pass')).toBe('pass');
    expect(storage.check_hook_output('test.hook', 1000)).toBe(1000);
    for (const output of [999, 1.5, null, 'ok', 0, -1, 2 ** 53, undefined]) {
      expect(() => storage.check_hook_output('test.hook', output)).toThrow(/test\.hook/);
    }
    const content = storage.content as unknown as Record<string, unknown>;
    expect(content.check_hook_output).toBeUndefined();
    expect('check_hook_output' in content).toBe(false);
  });
});
