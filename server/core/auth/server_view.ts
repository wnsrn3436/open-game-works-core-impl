/**
 * auth's view of the module input `server` (`server-core` `## module`): secrets by their `environments.<ENV>.secrets`
 * key, the outgoing HTTP adapter with a response byte limit, and the key source and fake adapter overrides.
 */
import type { webcrypto } from 'node:crypto';
import type { AuthInput, AuthServer, HttpAdapter, HttpRequest, HttpResult, KeySource, SocialAdapterKey } from './deps.ts';

/** Reads a response body up to `max` bytes; null when it is longer. */
async function limited_body(response: Response, max: number): Promise<Uint8Array | null> {
  const reader = (response.body as ReadableStream<Uint8Array> | null)?.getReader();
  if (reader === undefined) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

/** The HTTP adapter over the outgoing HTTP adapter of the server instance. */
function http_of(fetch: AuthInput['server']['fetch']): HttpAdapter {
  return async (request: HttpRequest): Promise<HttpResult> => {
    try {
      const init: RequestInit = { method: request.method, headers: request.headers, signal: request.signal };
      if (request.body !== null) init.body = request.body;
      const response = await fetch(request.url, init);
      const body = await limited_body(response, request.max_response_bytes);
      if (body === null) return { ok: false, failure: 'too_large' };
      return { ok: true, status: response.status, body };
    } catch {
      return { ok: false, failure: request.signal.aborted ? 'timeout' : 'communication' };
    }
  };
}

/** auth's key source of a key source override: the value is the provider JWKS document or its key list. */
function key_source_of(source: () => Promise<unknown>): KeySource {
  return async () => {
    let value: unknown;
    try {
      value = await source();
    } catch {
      return { ok: false, failure: 'communication' };
    }
    if (value === 'timeout') return { ok: false, failure: 'timeout' };
    if (value === 'communication_failure') return { ok: false, failure: 'communication' };
    const keys = Array.isArray(value) ? (value as unknown[]) : (value as { keys?: unknown } | null)?.keys;
    if (!Array.isArray(keys)) return { ok: false, failure: 'communication' };
    return { ok: true, keys: keys.filter((k): k is webcrypto.JsonWebKey => typeof k === 'object' && k !== null) };
  };
}

/**
 * auth's view of its server instance. A LOCAL server and a test server (they get `--db`) read a secret from
 * `--secret-file` by its key; the other servers read the host secret store secret named by game settings
 * `environments.<ENV>.secrets.<key>`.
 */
export function auth_server(input: AuthInput): AuthServer {
  const server = input.server;
  return {
    env: server.env,
    listen_port: () => server.port(),
    read_secret: (key) => {
      if (server.db !== null) return server.read_secret(key);
      const name = input.settings[`environments.<ENV>.secrets.${key}`];
      return typeof name === 'string' && name !== '' ? server.read_secret(name) : null;
    },
    data: server.data,
    read_data_file: (name) => server.read_data_file(name),
    http: http_of(server.fetch),
    key_source: (key: SocialAdapterKey) => {
      const source = server.key_sources[key];
      return source === undefined ? null : key_source_of(source);
    },
    fake_adapter: (key: SocialAdapterKey) => server.fake_adapters[key] ?? null,
  };
}
