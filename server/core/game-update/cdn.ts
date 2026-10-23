/**
 * The `cdn` adapter interface (`game-update` `### CDN adapter`): `base_url()` and `put(sha256, bytes)`. The fake
 * adapter (`dev/adapters/fake.ts`) and the real adapter `cdn-r2` (`adapters/cdn_r2.ts`) follow it.
 */

export interface CdnAdapter {
  /** The absolute URL file URLs start with. The fake adapter gives null while no base URL is set: no adapter. */
  base_url(): string | null;
  /**
   * Uploads a file. `signal` is the `game-update.cdnTimeoutMs` time limit of that one file. True on success; false
   * on failure and on the time limit.
   */
  put(sha256: string, bytes: Uint8Array, signal: AbortSignal): Promise<boolean>;
}

/** The outgoing HTTP adapter: `fetch` of the server instance (`server-core` `## adapter`). */
export type OutgoingHttp = (url: string, init: RequestInit) => Promise<Response>;

export function is_cdn_adapter(value: unknown): value is CdnAdapter {
  const adapter = value as Partial<CdnAdapter> | null | undefined;
  return typeof adapter?.base_url === 'function' && typeof adapter.put === 'function';
}
