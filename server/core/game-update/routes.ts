/**
 * The routes of game-update (`game-update` `## API`, `### serving`): `GET /update/deploy_list.json`,
 * `GET /update/deploy_list.json.sig` and `GET /update/files/<sha256>`. They skip the request processing order and
 * authentication; `routing` adds the CORS headers.
 */
import type { DeployListCache } from './cache.ts';
import { deploy_list_cache_control, file_cache_control, is_sha256 } from './deploy_list.ts';
import type { DbHandle } from './deps.ts';
import { file_content } from './store.ts';

/** The route request `routing` gives a route handler (`routing` `## API`). game-update reads only `path`. */
export interface RouteRequest {
  readonly method: string;
  /** The URL path without the query string. */
  readonly path: string;
  readonly query: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** The route response of a route handler (`routing` `## API`). */
export interface RouteResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array | string;
}

export type RouteHandler = (request: RouteRequest, client_ip: string) => RouteResponse;

export const DEPLOY_LIST_ROUTE = 'GET /update/deploy_list.json';
export const SIGNATURE_ROUTE = 'GET /update/deploy_list.json.sig';
export const FILES_ROUTE = 'GET /update/files/<sha256>';

const FILES_PREFIX = '/update/files/';

/** HTTP 404 with no body. */
const NOT_FOUND: RouteResponse = { status: 404 };

/** The route methods of the module object, named by their route strings. */
export interface Routes {
  readonly [DEPLOY_LIST_ROUTE]: RouteHandler;
  readonly [SIGNATURE_ROUTE]: RouteHandler;
  readonly [FILES_ROUTE]: RouteHandler;
}

export interface RouteInput {
  /** The current deploy list; null when there is none or it cannot be read. */
  readonly current: DeployListCache['current'];
  readonly read_db: () => DbHandle;
  readonly deploy_list_max_age_ms: number;
  readonly file_max_age_ms: number;
}

export function create_routes(input: RouteInput): Routes {
  const list_headers = { 'Cache-Control': deploy_list_cache_control(input.deploy_list_max_age_ms), 'Content-Type': 'application/json' };
  const file_headers = { 'Cache-Control': file_cache_control(input.file_max_age_ms), 'Content-Type': 'application/octet-stream' };
  return {
    [DEPLOY_LIST_ROUTE]: () => {
      const entry = input.current();
      return entry === null ? NOT_FOUND : { status: 200, headers: list_headers, body: entry.deploy_list };
    },
    [SIGNATURE_ROUTE]: () => {
      const entry = input.current();
      return entry === null ? NOT_FOUND : { status: 200, headers: list_headers, body: entry.signature };
    },
    [FILES_ROUTE]: (request) => {
      const sha256 = request.path.startsWith(FILES_PREFIX) ? request.path.slice(FILES_PREFIX.length) : '';
      if (!is_sha256(sha256)) return NOT_FOUND;
      const content = file_content(input.read_db(), sha256);
      return content === null ? NOT_FOUND : { status: 200, headers: file_headers, body: content };
    },
  };
}
