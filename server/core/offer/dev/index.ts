// offer DEV code: `set_offer`.
import type { RequestCtx } from '../deps.ts';
import type { Offer } from '../index.ts';

/** The `## DEV` operations of `offer`. */
export interface OfferDev {
  set_offer(ctx: RequestCtx, offer_id: number, started_at: bigint | number, trigger_count: bigint | number): null;
}

const INT64_MAX = 2n ** 63n - 1n;
const INT32_MAX = 2n ** 31n - 1n;

/** An integer input of `set_offer` from 0 to `max`; anything else throws. */
function integer_input(name: string, value: unknown, max: bigint): bigint {
  if (typeof value !== 'number' && typeof value !== 'bigint') throw new TypeError(`set_offer: ${name} is not an integer`);
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new RangeError(`set_offer: ${name} ${String(value)} is not an integer`);
  const integer = BigInt(value);
  if (integer < 0n || integer > max) throw new RangeError(`set_offer: ${name} ${String(value)} is not in [0, ${String(max)}]`);
  return integer;
}

/** The DEV code of `offer` for a server instance with DEV code. */
export function create_offer_dev(offer: Offer): OfferDev {
  return {
    set_offer(ctx, offer_id, started_at, trigger_count) {
      const at = integer_input('started_at', started_at, INT64_MAX);
      const count = integer_input('trigger_count', trigger_count, INT32_MAX);
      offer.write_offer(ctx, offer_id, at, Number(count));
      return null;
    },
  };
}
