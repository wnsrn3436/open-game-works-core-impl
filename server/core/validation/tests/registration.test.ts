import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import * as testing from '../../testing/dev/index.ts';
import { core_test_register_dev, register_required_hooks } from '../../testing/dev/index.ts';
import type { RequirementJudge, Validation } from '../index.ts';
import { emptyData, requirementTable, standalone, withContainer } from './standalone.ts';

const { None, FlagA, FlagB, ItemAtLeast } = GameData.RequirementType;
const judge: RequirementJudge = () => true;

/** A module over `requirement` rows of the given types: rows 1, 2, … in order. */
function moduleWithTypes(types: readonly GameData.RequirementType[]) {
  return standalone(withContainer(emptyData(), 'RequirementTable', requirementTable(types.map((type, i) => ({ id: i + 1, type })))));
}

describe('requirement judge registration', () => {
  it('starts when every type of the requirement rows has a judge hook', () => {
    const v = moduleWithTypes([FlagA, ItemAtLeast]);
    v.begin_start();
    v.register_requirement_judge(FlagA, judge);
    v.register_requirement_judge(ItemAtLeast, judge);
    expect(v.complete_start()).toBeNull();
  });

  it('does not start when a type of a requirement row has no judge hook', () => {
    const v = moduleWithTypes([FlagA, ItemAtLeast]);
    v.begin_start();
    v.register_requirement_judge(FlagA, judge);
    expect(v.complete_start()).toContain('ItemAtLeast');
  });

  it('does not need a judge hook for a group row, whose type is None', () => {
    const table = requirementTable([{ id: 1, type: None, children: [2], logic: GameData.RequirementLogic.All }, { id: 2, type: FlagB }]);
    const v = standalone(withContainer(emptyData(), 'RequirementTable', table));
    v.begin_start();
    v.register_requirement_judge(FlagB, judge);
    expect(v.complete_start()).toBeNull();
  });

  it('does not start on a second judge hook of the same type', () => {
    const v = moduleWithTypes([]);
    v.begin_start();
    v.register_requirement_judge(FlagA, judge);
    v.register_requirement_judge(FlagA, judge);
    expect(v.complete_start()).toContain('FlagA');
  });

  it('does not start on a judge hook of None or of a value that is not a RequirementType element', () => {
    const none = moduleWithTypes([]);
    none.begin_start();
    none.register_requirement_judge(None, judge);
    expect(none.complete_start()).toContain('None');
    const unknown = moduleWithTypes([]);
    unknown.begin_start();
    unknown.register_requirement_judge(99 as GameData.RequirementType, judge);
    expect(unknown.complete_start()).not.toBeNull();
  });

  it('does not start on a judge hook that is not a function', () => {
    const v = moduleWithTypes([]);
    v.begin_start();
    v.register_requirement_judge(FlagA, 'judge' as unknown as RequirementJudge);
    expect(v.complete_start()).not.toBeNull();
  });

  it('does not start on a registration before register, and throws on one after the start', () => {
    const before = moduleWithTypes([]);
    before.register_requirement_judge(FlagA, judge);
    before.begin_start();
    expect(before.complete_start()).toContain('outside register');
    const after = moduleWithTypes([]);
    after.begin_start();
    expect(after.complete_start()).toBeNull();
    expect(() => {
      after.register_requirement_judge(FlagA, judge);
    }).toThrow();
  });

  describe('in a server instance with DEV code', () => {
    interface Core {
      readonly routing: { register_handler(name: string, handler: () => unknown): void };
      readonly validation: Validation;
    }

    /** Content `register`: every `rpc` handler and required hook, and a judge hook of every type but `FlagA`. */
    const registerWithoutFlagA = (raw: Readonly<Record<string, unknown>>): void => {
      const core = raw as unknown as Core;
      for (const info of GameContract.RPCS) core.routing.register_handler(info.name, () => new info.response_class());
      register_required_hooks(raw);
      for (const type of Object.values(GameData.RequirementType)) {
        if (type !== None && type !== FlagA) core.validation.register_requirement_judge(type, () => false);
      }
    };

    it('does not start on a judge hook registered in registerDev, which is outside register', async () => {
      const registerDev = (raw: Readonly<Record<string, unknown>>): void => {
        core_test_register_dev(raw);
        (raw as unknown as Core).validation.register_requirement_judge(FlagA, judge);
      };
      await expect(testing.start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, registerWithoutFlagA, registerDev)).rejects.toThrow(
        'validation.register_requirement_judge is called outside register',
      );
    });

    it('starts with the same judge hook registered in register', async () => {
      const register = (raw: Readonly<Record<string, unknown>>): void => {
        registerWithoutFlagA(raw);
        (raw as unknown as Core).validation.register_requirement_judge(FlagA, judge);
      };
      const server = await testing.start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register, core_test_register_dev);
      await testing.stop_test_server(server);
    });
  });
});
