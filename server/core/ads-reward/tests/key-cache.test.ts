import { network_time_limit } from '../../server-time/network_time_limit.ts';
import { FORMAT_ERROR, type AdsAdapter } from '../adapter.ts';
import { KeyCache } from '../callback.ts';
import type { AdsRewardCore } from '../grant.ts';

/** A key cache whose core has the clock, the network time limit and a log writer that keeps the lines. */
function cache_of(): { cache: KeyCache; messages: string[] } {
  const messages: string[] = [];
  const core = {
    settings: { key_cache_ms: 600_000n, key_refetch_interval_ms: 60_000n, key_fetch_timeout_ms: 1_000n },
    m: {
      time: { clock_now: () => 1_799_971_200_000n, network_time_limit },
      logging: { write: (entry: { message: string }) => messages.push(entry.message) },
    },
  } as unknown as AdsRewardCore;
  return { cache: new KeyCache(core), messages };
}

function adapter_of(fetch_keys: AdsAdapter['fetch_keys']): AdsAdapter {
  return { name: 'ads-admob', parse: () => FORMAT_ERROR, fetch_keys, verify: () => false };
}

describe('ads-reward key cache', () => {
  it('takes a fetch_keys throw, a RangeError included, as communication_failure, not as timeout', async () => {
    const throws = [
      () => {
        throw new RangeError('adapter bug');
      },
      () => Promise.reject(new RangeError('adapter bug')),
      () => Promise.reject(new Error('socket closed')),
    ];
    for (const fetch_keys of throws) {
      const { cache, messages } = cache_of();
      expect(await cache.keys_for(adapter_of(fetch_keys), '7')).toBeNull();
      expect(messages).toEqual(['ads signing key fetch of ads-admob failed: communication_failure']);
    }
  });
});
