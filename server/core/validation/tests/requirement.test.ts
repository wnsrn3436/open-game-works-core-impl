import { readFileSync } from 'node:fs';
import * as GameData from '../../../generated/data/game_data.ts';
import type { ItemConverter, RequestCtx } from '../../storage/index.ts';
import { quest, QuestUserState, TEST_CONTRACT_VERSION } from '../../storage/tests/kinds.ts';
import { PASS, type RequirementResult } from '../index.ts';
import {
  amount, idOf, inRequest, inRollback, newUser, registerJudges, registerOtherJudges, requirementOf, savedState, startOrFail, startServer, stopAll, type Register, type Started,
} from './server.ts';

const { FlagA, FlagB, FlagC, ItemAtLeast, ClientOnly, None } = GameData.RequirementType;
const FLAG_NAMES = new Map<GameData.RequirementType, string>([[FlagA, 'FlagA'], [FlagB, 'FlagB'], [FlagC, 'FlagC']]);

interface FixtureCase {
  name: string;
  input: { requirement: string | 0; user_state: unknown[]; judge: Record<string, boolean> };
  expected: { passed: boolean; failed_requirement_id: string | 0 };
}

function fixture(name: string): FixtureCase[] {
  const text = readFileSync(new URL(`../../../../fixtures/${name}.json`, import.meta.url), 'utf8');
  return (JSON.parse(text) as { cases: FixtureCase[] }).cases;
}

const GOLD = idOf('[validation_gold]');
const SINGLE = requirementOf('validation_req_single');
const ALL = requirementOf('validation_req_all');
const ANY = requirementOf('validation_req_any');
const NESTED = requirementOf('validation_req_nested');

/** The converter `migration` registers, in the part these tests need: a quest of a lower contract version gains 100. */
const converter: ItemConverter = (_db, kind, _itemId, _version, bytes) => {
  if (kind !== QuestUserState) return bytes;
  const q = QuestUserState.decode(bytes);
  return q === null ? 'FAILED' : quest(q.id, q.progress + 100n).encode();
};

describe('evaluate_requirement', () => {
  /** The flag judge hooks answer from `answers`: a boolean, another value, or `'throw'`. */
  const answers = new Map<string, unknown>();
  const calls: string[] = [];
  let inJudge: ((ctx: RequestCtx) => void) | null = null;
  let started: Started;
  let user: bigint;

  function flag(ctx: RequestCtx, type: GameData.RequirementType): boolean {
    const name = FLAG_NAMES.get(type) ?? '';
    calls.push(name);
    inJudge?.(ctx);
    const answer = answers.get(name) ?? false;
    if (answer === 'throw') throw new Error('judge hook failure');
    return answer as boolean;
  }

  function answer(values: Record<string, unknown>): void {
    answers.clear();
    calls.length = 0;
    for (const [name, value] of Object.entries(values)) answers.set(name, value);
  }

  function evaluate(id: number, userId = user): Promise<RequirementResult> {
    return inRollback(started, userId, (ctx) => started.validation.evaluate_requirement(ctx, id));
  }

  beforeAll(async () => {
    started = await startServer((core) => {
      registerJudges(core, flag);
      core.storage.register_item_converter(converter);
    });
    user = await newUser(started);
  });

  afterAll(() => {
    stopAll();
  });

  beforeEach(() => {
    inJudge = null;
    answer({});
  });

  it('gives the expected passed and failed_requirement_id for every case of the core test fixture requirement-evaluation', async () => {
    const cases = fixture('requirement-evaluation');
    expect(cases.some((c) => c.input.requirement === 0)).toBe(true);
    for (const c of cases) {
      answer(c.input.judge);
      const result = await evaluate(idOf(c.input.requirement));
      expect(result, c.name).toEqual({ passed: c.expected.passed, failed_requirement_id: idOf(c.expected.failed_requirement_id) });
      if (c.input.requirement === 0) expect(calls, c.name).toEqual([]);
    }
  });

  it('does not call the judge hooks of the items after the stop item', async () => {
    answer({ FlagA: true, FlagB: false, FlagC: true });
    await evaluate(ALL);
    expect(calls).toEqual(['FlagA', 'FlagB']);
    answer({ FlagA: true, FlagB: true });
    await evaluate(ANY);
    expect(calls).toEqual(['FlagA']);
    answer({ FlagA: false, FlagB: true, FlagC: true });
    await evaluate(NESTED);
    expect(calls).toEqual(['FlagA']);
  });

  it('judges again on every call: there is no cache', async () => {
    answer({ FlagA: true });
    await evaluate(SINGLE);
    await evaluate(SINGLE);
    expect(calls).toEqual(['FlagA', 'FlagA']);
    answer({ FlagA: false });
    expect(await evaluate(SINGLE)).toEqual({ passed: false, failed_requirement_id: SINGLE });
  });

  it('throws for a requirement ID value that is not 0 and not in the requirement table, and for a judge hook that throws or does not return a boolean', async () => {
    answer({ FlagA: true });
    await expect(inRequest(started, user, (ctx) => started.validation.evaluate_requirement(ctx, 2_000_000_000))).rejects.toThrow();
    answer({ FlagA: 'throw' });
    await expect(inRequest(started, user, (ctx) => started.validation.evaluate_requirement(ctx, SINGLE))).rejects.toThrow();
    answer({ FlagA: 1 });
    await expect(inRequest(started, user, (ctx) => started.validation.evaluate_requirement(ctx, SINGLE))).rejects.toThrow();
    answer({ FlagA: 'yes' });
    await expect(inRequest(started, user, (ctx) => started.validation.evaluate_requirement(ctx, SINGLE))).rejects.toThrow();
  });

  it('throws on put_state in a judge hook, and the request ends with the saved state as it was', async () => {
    const writeUser = await newUser(started);
    // The same put_state outside a judge hook commits, so the throw is the judge hook's.
    const other = await newUser(started);
    await inRequest(started, other, (ctx) => {
      started.storage.put_state(ctx, quest(1n, 5n));
    });
    expect(savedState(started, other).user_state).toHaveLength(1);
    const before = savedState(started, writeUser);
    answer({ FlagA: true });
    inJudge = (ctx) => {
      started.storage.put_state(ctx, quest(1n, 5n));
    };
    await expect(inRequest(started, writeUser, (ctx) => started.validation.evaluate_requirement(ctx, SINGLE))).rejects.toThrow();
    inJudge = (ctx) => {
      started.core['item-ledger'].add_items(ctx, [amount(GOLD, 5n)]);
    };
    await expect(inRequest(started, writeUser, (ctx) => started.validation.evaluate_requirement(ctx, SINGLE))).rejects.toThrow();
    expect(savedState(started, writeUser)).toEqual(before);
  });

  it('gives a judge hook the recovery item balance at the request time through item-ledger.get_balance and writes nothing', async () => {
    const recoveryUser = await newUser(started);
    started.clock.advance(3n * 60_000n);
    const before = savedState(started, recoveryUser);
    expect(await inRequest(started, recoveryUser, (ctx) => started.validation.evaluate_requirement(ctx, requirementOf('validation_req_energy_3')))).toEqual({
      passed: true, failed_requirement_id: 0,
    });
    const four = requirementOf('validation_req_energy_4');
    expect(await inRequest(started, recoveryUser, (ctx) => started.validation.evaluate_requirement(ctx, four))).toEqual({ passed: false, failed_requirement_id: four });
    started.clock.advance(60_000n);
    expect(await inRequest(started, recoveryUser, (ctx) => started.validation.evaluate_requirement(ctx, four))).toEqual({ passed: true, failed_requirement_id: 0 });
    expect(savedState(started, recoveryUser)).toEqual(before);
  });

  it('gives a judge hook the converted value of a row with a lower contract version and leaves the stored row', async () => {
    const oldUser = await newUser(started);
    const lower = BigInt(TEST_CONTRACT_VERSION - 1);
    await inRequest(started, oldUser, (ctx) => {
      started.storage.replace_user_rows(ctx, [{ table: 'user_state', key: 'quest_user_state/1', contract_version: lower, value: quest(1n, 7n).encode() }]);
    });
    const before = savedState(started, oldUser);
    let seen: unknown = null;
    answer({ FlagA: true });
    inJudge = (ctx) => {
      seen = started.storage.get_state(ctx, QuestUserState, 1n);
    };
    expect(await inRequest(started, oldUser, (ctx) => started.validation.evaluate_requirement(ctx, SINGLE))).toEqual({ passed: true, failed_requirement_id: 0 });
    expect((seen as QuestUserState | null)?.progress).toBe(107n);
    expect(savedState(started, oldUser)).toEqual(before);
    const stored = started.storage.read_db().query('SELECT contract_version FROM user_state WHERE user_id = $1', [oldUser]);
    expect(stored.map((r) => r.contract_version)).toEqual([lower]);
  });
});

describe('evaluate_requirement in validate_item_change', () => {
  afterEach(() => {
    stopAll();
  });

  it('judges an item holding condition with the balance before the change, and the item change does not end with INTERNAL', async () => {
    const passed: boolean[] = [];
    const gold = requirementOf('validation_req_gold');
    const started = await startServer();
    started.validate_item_change = (ctx) => {
      passed.push(started.validation.evaluate_requirement(ctx, gold).passed);
      return PASS;
    };
    const user = await newUser(started);
    const balance = await inRequest(started, user, (ctx) => {
      const outcomes = [3n, 10n, 2n].map((value) => started.core['item-ledger'].add_items(ctx, [amount(GOLD, value)]));
      return { outcomes, balance: started.core['item-ledger'].get_balance(ctx, GOLD) };
    });
    expect(passed).toEqual([false, false, true]);
    expect(balance.outcomes).toEqual(['OK', 'OK', 'OK']);
    expect(balance.balance).toBe(15n);
  });
});

describe('server start with requirement rows', () => {
  afterEach(() => {
    stopAll();
  });

  async function startFailure(register: Register): Promise<string | null> {
    const started = await startOrFail(register);
    return typeof started === 'string' ? started : null;
  }

  it('does not start without the judge hook of a type in a column of build target All', async () => {
    const failure = await startFailure((core) => {
      for (const type of [FlagB, FlagC, ItemAtLeast]) core.validation.register_requirement_judge(type, () => true);
      registerOtherJudges(core);
    });
    expect(failure).toContain('FlagA');
  });

  it('does not start without the judge hook of a type in a column of build target Server', async () => {
    const failure = await startFailure((core) => {
      for (const type of [FlagA, FlagB, FlagC]) core.validation.register_requirement_judge(type, () => true);
      registerOtherJudges(core);
    });
    expect(failure).toContain('ItemAtLeast');
  });

  it('starts without a judge hook of a type only columns of build target Client use', async () => {
    expect(await startFailure(registerJudges)).toBeNull();
  });

  it('does not start on a second judge hook of a type, a judge hook of None, or a registration after the start', async () => {
    expect(await startFailure((core) => {
      registerJudges(core);
      core.validation.register_requirement_judge(FlagA, () => true);
    })).toContain('FlagA');
    expect(await startFailure((core) => {
      registerJudges(core);
      core.validation.register_requirement_judge(None, () => true);
    })).toContain('None');
    const started = await startServer();
    expect(() => {
      started.validation.register_requirement_judge(ClientOnly, () => true);
    }).toThrow();
  });
});
