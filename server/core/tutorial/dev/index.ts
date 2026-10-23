import type { RequestCtx } from '../../storage/index.ts';
import type { TutorialModule } from '../index.ts';

/** The `## DEV` operations of `tutorial`. */
export interface TutorialDev {
  /** Sets the stored step, smaller ones too. 0 deletes the row. A step that is not 0 and not in `tutorial_step` throws. */
  set_tutorial_step(ctx: RequestCtx, tutorial_id: number, step: number): null;
}

export function create_tutorial_dev(tutorial: TutorialModule): TutorialDev {
  return {
    set_tutorial_step(ctx, tutorial_id, step) {
      if (!Number.isSafeInteger(step) || (step !== 0 && !tutorial.has_step(ctx, tutorial_id, step))) {
        throw new TypeError(`tutorial: set_tutorial_step of a step not in tutorial_step: ${String(tutorial_id)}, ${String(step)}`);
      }
      tutorial.write_step(ctx, tutorial_id, step);
      return null;
    },
  };
}
