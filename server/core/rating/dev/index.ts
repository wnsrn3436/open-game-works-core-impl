import type { RequestCtx } from '../../storage/index.ts';
import type { Rating } from '../index.ts';

/** The `## DEV` operations of `rating` for one server instance. */
export interface RatingDev {
  /** Writes the settled row of the ctx user with that rating and its tier. Throws for a rule not in `rating_rule`. */
  set_rating(ctx: RequestCtx, rule_id: number, rating: bigint | number): null;
}

/** The DEV operations of the server instance's `rating`. */
export function create_rating_dev(rating: Rating): RatingDev {
  return {
    set_rating: (ctx, rule_id, value) => {
      rating.write_rating(ctx, rule_id, BigInt(value));
      return null;
    },
  };
}
