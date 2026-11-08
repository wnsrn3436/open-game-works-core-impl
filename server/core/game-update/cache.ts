/**
 * The current deploy list cache of one server instance (`game-update` `### serving`). Job `game_update_cache`
 * reads it again; the instance that publishes sets it in the `after_commit` function of that publish.
 */
import { stored_min_versions, stored_patches } from './deploy_list.ts';
import type { GameUpdateValidation } from './deps.ts';
import type { StoredDeployList } from './store.ts';

export interface CachedDeployList {
  readonly sequence: bigint;
  readonly published_at: bigint;
  readonly deploy_list: Uint8Array;
  readonly signature: Uint8Array;
  /** App version → `data_version` of its patch entry. */
  readonly data_versions: ReadonlyMap<string, string>;
  /** Platform → `min_version` of its `app` entry. */
  readonly min_versions: ReadonlyMap<string, string>;
}

function cached(row: StoredDeployList): CachedDeployList {
  const data_versions = new Map<string, string>();
  for (const [version, patch] of stored_patches(row.deploy_list)) data_versions.set(version, patch.data_version);
  return {
    sequence: row.sequence,
    published_at: row.published_at,
    deploy_list: row.deploy_list,
    signature: Buffer.from(row.signature, 'utf8'),
    data_versions,
    min_versions: stored_min_versions(row.deploy_list),
  };
}

/**
 * `is_data_update_ready` on a cached deploy list: the app version has a patch entry, its `data_version` is one of
 * the server's client data versions, and `now` ≥ `published_at` + `wait_ms` (`deployListMaxAgeMs` +
 * `cacheRefreshMs`).
 */
export function data_update_ready(
  entry: CachedDeployList | null,
  app_version: string,
  client_data_versions: readonly (string | null)[],
  now: bigint,
  wait_ms: bigint,
): boolean {
  const data_version = entry?.data_versions.get(app_version);
  if (entry === null || data_version === undefined || !client_data_versions.includes(data_version)) return false;
  return now >= entry.published_at + wait_ms;
}

/**
 * `is_below_min_version` on a cached deploy list: the platform has an `app` entry, `validation.parse_version` reads
 * the app version, and `validation.compare_versions` puts it below that entry's `min_version`.
 */
export function below_min_version(entry: CachedDeployList | null, app_version: string, platform: string, validation: GameUpdateValidation): boolean {
  const min_text = entry?.min_versions.get(platform);
  if (min_text === undefined) return false;
  const version = validation.parse_version(app_version);
  const min_version = validation.parse_version(min_text);
  if (version === null || min_version === null) return false;
  return validation.compare_versions(version, min_version) < 0;
}

export class DeployListCache {
  readonly #read: () => StoredDeployList | null;
  #entry: CachedDeployList | null = null;
  #loaded = false;

  constructor(read: () => StoredDeployList | null) {
    this.#read = read;
  }

  /** Reads the current deploy list from the DB into the cache. Throws when the read throws. */
  refresh(): void {
    const row = this.#read();
    this.#entry = row === null ? null : cached(row);
    this.#loaded = true;
  }

  /** Sets a deploy list this instance published; an `after_commit` function that comes after a newer one does nothing. */
  set_published(row: StoredDeployList): void {
    if (this.#entry !== null && this.#entry.sequence > row.sequence) return;
    this.#entry = cached(row);
    this.#loaded = true;
  }

  /** The current deploy list; reads it first when the cache has not been read yet. */
  current(): CachedDeployList | null {
    if (!this.#loaded) this.refresh();
    return this.#entry;
  }
}
