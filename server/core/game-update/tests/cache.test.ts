import { data_update_ready, DeployListCache } from '../cache.ts';
import { deploy_list_bytes, parse_deploy_list_input } from '../deploy_list.ts';
import type { StoredDeployList } from '../store.ts';

const CLIENT = 'p1-d1';
const COMPAT = 'p0-d0';
const PUBLISHED_AT = 1_000_000n;
const WAIT = 90_000n;

function row(sequence: bigint, data_version: string, version = '1.0.0'): StoredDeployList {
  const input = parse_deploy_list_input({
    app: {},
    patches: { [version]: { data_version, data_files: [{ name: 'a.bin', size: 1, sha256: 'a'.repeat(64) }], translation_files: [], bundle_files: [] } },
  });
  const deploy_list = deploy_list_bytes(input, { environment: 'LOCAL', sequence, published_at: PUBLISHED_AT, file_base_url: 'files/' });
  return { sequence, deploy_list, signature: `{"sequence":${String(sequence)}}`, published_at: PUBLISHED_AT };
}

describe('is_data_update_ready decision', () => {
  it('is false without a deploy list and before published_at + deployListMaxAgeMs + cacheRefreshMs, true from then', () => {
    expect(data_update_ready(null, '1.0.0', [CLIENT, null], PUBLISHED_AT + WAIT, WAIT)).toBe(false);
    const cache = new DeployListCache(() => row(1n, CLIENT));
    expect(data_update_ready(cache.current(), '1.0.0', [CLIENT, null], PUBLISHED_AT + WAIT - 1n, WAIT)).toBe(false);
    expect(data_update_ready(cache.current(), '1.0.0', [CLIENT, null], PUBLISHED_AT + WAIT, WAIT)).toBe(true);
  });

  it('is false for an app version without a patch entry and for a data_version that is neither client data version', () => {
    const cache = new DeployListCache(() => row(1n, COMPAT));
    const later = PUBLISHED_AT + WAIT;
    expect(data_update_ready(cache.current(), '2.0.0', [CLIENT, COMPAT], later, WAIT)).toBe(false);
    expect(data_update_ready(cache.current(), '1.0.0', [CLIENT, COMPAT], later, WAIT)).toBe(true);
    expect(data_update_ready(cache.current(), '1.0.0', [CLIENT, null], later, WAIT)).toBe(false);
  });
});

describe('deploy list cache', () => {
  it('reads on first use and serves what it read until the next refresh', () => {
    let stored: StoredDeployList | null = null;
    let reads = 0;
    const cache = new DeployListCache(() => {
      reads += 1;
      return stored;
    });
    expect(cache.current()).toBeNull();
    stored = row(5n, CLIENT);
    expect(cache.current()).toBeNull();
    expect(reads).toBe(1);
    cache.refresh();
    expect(cache.current()?.sequence).toBe(5n);
  });

  it('keeps the newer publish when the after_commit function of an older one comes later', () => {
    const cache = new DeployListCache(() => null);
    cache.set_published(row(2n, CLIENT));
    cache.set_published(row(1n, CLIENT));
    expect(cache.current()?.sequence).toBe(2n);
    expect(Buffer.from(cache.current()?.signature ?? []).toString('utf8')).toBe('{"sequence":2}');
  });
});
