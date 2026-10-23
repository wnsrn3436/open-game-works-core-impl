/**
 * tutorial: stores each user's tutorial progress step in the core UserState kind `TutorialProgressUserState` and
 * handles the core rpc `SaveTutorialProgress`. Start, step progress and screens are the client's.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { Logging } from '../logging/index.ts';
import type { RequestCtx, Storage } from '../storage/index.ts';

/** The `storage` operations tutorial calls. */
export type TutorialStorage = Pick<Storage, 'get_state' | 'put_core_state' | 'delete_core_state'>;

/** The `logging` operations tutorial calls. */
export type TutorialLogging = Pick<Logging, 'write' | 'track_core_event'>;

/** The module input (`server-core` `## module`). tutorial has no settings and reads nothing of `server`. */
export interface TutorialInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: unknown;
}

/** What content `register(core)` gets as `tutorial` (`server-core` `## module`): the operations content code calls. */
export interface TutorialContent {
  get_tutorial_step(ctx: RequestCtx, tutorial_id: number): number;
}

export interface TutorialModule {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  SaveTutorialProgress(
    ctx: RequestCtx,
    request: CoreContract.SaveTutorialProgressRequest,
  ): CoreContract.SaveTutorialProgressResponse | CoreContract.CoreError;
  get_tutorial_step(ctx: RequestCtx, tutorial_id: number): number;
  /** For the DEV code: whether `tutorial_step` has the row (tutorial ID value, step). */
  has_step(ctx: RequestCtx, tutorial_id: number, step: number): boolean;
  /** For the DEV code: writes the stored step of the tutorial, or deletes its row when the step is 0. */
  write_step(ctx: RequestCtx, tutorial_id: number, step: number): void;
  readonly content: TutorialContent;
}

const MODULE = 'tutorial';
const CORE_EVENT = 'core_tutorial_step';

function module_of(modules: Readonly<Record<string, unknown>>, name: string): unknown {
  const module = modules[name];
  if (typeof module !== 'object' || module === null) throw new TypeError(`tutorial: module ${name} is missing`);
  return module;
}

/** An ID value or step as a `TutorialProgressUserState` item ID; throws on a value that cannot be one. */
function item_id(tutorial_id: number): bigint {
  if (!Number.isSafeInteger(tutorial_id) || tutorial_id < 0) throw new TypeError(`tutorial: invalid tutorial ID value ${String(tutorial_id)}`);
  return BigInt(tutorial_id);
}

export function create_tutorial(input: TutorialInput): TutorialModule {
  const storage = module_of(input.modules, 'storage') as TutorialStorage;
  const logging = module_of(input.modules, 'logging') as TutorialLogging;

  const stored_step = (ctx: RequestCtx, tutorial_id: number): number => {
    const row = storage.get_state(ctx, CoreContract.TutorialProgressUserState, item_id(tutorial_id)) as CoreContract.TutorialProgressUserState | null;
    return row === null ? 0 : row.step;
  };

  const has_step = (ctx: RequestCtx, tutorial_id: number, step: number): boolean =>
    ctx.data.TutorialStepTable.get_rows(tutorial_id).some((row) => row.step === step);

  const write_step = (ctx: RequestCtx, tutorial_id: number, step: number): void => {
    const id = item_id(tutorial_id);
    if (step === 0) {
      storage.delete_core_state(ctx, CoreContract.TutorialProgressUserState, id);
      return;
    }
    const row = new CoreContract.TutorialProgressUserState();
    row.id = id;
    row.step = step;
    storage.put_core_state(ctx, row);
  };

  const get_tutorial_step = (ctx: RequestCtx, tutorial_id: number): number => stored_step(ctx, tutorial_id);

  return {
    begin_start() {},
    complete_start() {
      return null;
    },
    stop() {},

    SaveTutorialProgress(ctx, request) {
      const { tutorial_id, step } = request;
      if (!has_step(ctx, tutorial_id, step)) {
        logging.write({
          kind: 'core',
          level: 'warn',
          message: 'tutorial step is not in tutorial_step',
          user_id: ctx.user_id,
          request_id: ctx.request_id === '' ? null : ctx.request_id,
          request: ctx.request_name === '' ? null : ctx.request_name,
          fields: { module: MODULE, tutorial_id, step },
        });
        return CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
      }
      // Progress only grows: a smaller or equal step, such as one that arrived out of order, changes nothing.
      if (stored_step(ctx, tutorial_id) >= step) return new CoreContract.SaveTutorialProgressResponse();
      write_step(ctx, tutorial_id, step);
      logging.track_core_event(ctx, CORE_EVENT, [
        ['tutorial_id', tutorial_id],
        ['step', step],
      ]);
      return new CoreContract.SaveTutorialProgressResponse();
    },

    get_tutorial_step,
    has_step,
    write_step,
    content: { get_tutorial_step },
  };
}
