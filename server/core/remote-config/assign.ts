/** Experiment group assignment (`remote-config` `## behavior`). */
import { createHash } from 'node:crypto';

/** A group as assignment reads it: its name and weight (1 or more). */
export interface WeightedGroup {
  readonly name: string;
  readonly weight: bigint;
}

/**
 * The group of a user: h is the first 8 bytes of `SHA-256(<salt> ":" <user ID decimal>)` as a big-endian unsigned
 * integer, r = h mod (weight sum), and the group is the first one in order whose running weight sum is above r.
 */
export function assign_group<G extends WeightedGroup>(salt: string, groups: readonly G[], user_id: bigint): G {
  let total = 0n;
  for (const group of groups) total += group.weight;
  if (groups.length === 0 || total <= 0n) throw new RangeError('assign_group: no group with weight');
  const digest = createHash('sha256').update(`${salt}:${user_id.toString(10)}`, 'utf8').digest();
  const r = digest.readBigUInt64BE(0) % total;
  let running = 0n;
  for (const group of groups) {
    running += group.weight;
    if (r < running) return group;
  }
  throw new RangeError('assign_group: weight sum overflow');
}
