/**
 * Test servers for `notice`: admin operations through `send_admin`, and `GetNotices` as a raw HTTP request with no
 * access token, so each test picks the `X-Ogw-Platform` and `X-Ogw-Client-Version` values.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { core_test_server_paths, send_admin, send_raw, start_test_server, stop_test_server } from '../../testing/dev/index.ts';

export const START = 1_800_000_000_000n;
export const HOUR = 3_600_000n;

/** Two supported languages, so a test can ask for a language other than the source language. */
export const LANGUAGES: Readonly<Record<string, unknown>> = { supportedLanguages: ['en', 'ko'], sourceLanguage: 'en' };

type TestServer = Awaited<ReturnType<typeof start_test_server>>;

const running: TestServer[] = [];

/** A started test server at `START` with `LANGUAGES` and the given settings overrides, stopped by `stop_all`. */
export async function server(overrides: Readonly<Record<string, unknown>> = {}): Promise<TestServer> {
  const s = await start_test_server(START, undefined, undefined, undefined, undefined, { ...LANGUAGES, ...overrides });
  running.push(s);
  return s;
}

export async function stop_all(): Promise<void> {
  for (const s of running.splice(0)) await stop_test_server(s);
}

let operation = 0;

/** A `put_notice` input of a new notice visible for an hour from `START`, with texts in `en` and `ko`. */
export function notice_input(fields: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  operation += 1;
  return {
    operation_id: `op-${String(operation)}-${randomUUID()}`,
    notice_id: '0',
    kind: 'Notice',
    priority: 0,
    start_at: String(START),
    end_at: String(START + HOUR),
    platforms: [],
    languages: [],
    min_client_version: '',
    max_client_version: '',
    texts: [
      { language: 'en', title: 'Title', body: 'Body' },
      { language: 'ko', title: '제목', body: '본문' },
    ],
    image_url: '',
    shortcut_id: 0,
    link_url: '',
    ...fields,
  };
}

export interface AdminResult {
  readonly status: number;
  readonly json: unknown;
}

export async function admin(s: TestServer, name: string, body: unknown): Promise<AdminResult> {
  const result = await send_admin(s, name, body);
  return { status: result.status, json: result.json };
}

/** `put_notice` that must succeed: the new or changed notice ID. */
export async function put(s: TestServer, fields: Readonly<Record<string, unknown>> = {}): Promise<bigint> {
  const result = await admin(s, 'put_notice', notice_input(fields));
  if (result.status !== 200) throw new Error(`put_notice: HTTP ${String(result.status)} ${JSON.stringify(result.json)}`);
  return BigInt((result.json as { notice_id: string }).notice_id);
}

/** `put_notice` expected to fail: the HTTP status and the error reason. */
export async function put_failure(s: TestServer, fields: Readonly<Record<string, unknown>>): Promise<[number, unknown]> {
  const result = await admin(s, 'put_notice', notice_input(fields));
  return [result.status, (result.json as { error?: unknown } | null)?.error];
}

/** The `client_data_version` of the server build data, for the `X-Ogw-Data-Version` header. */
function data_version(): string {
  return readFileSync(join(core_test_server_paths().data_folder, 'client_data_version'), 'utf8').trim();
}

export interface Client {
  readonly language?: string;
  readonly platform?: string;
  /** The empty string is a dev run. */
  readonly client_version?: string;
}

/** `GetNotices` with no `Authorization` header; the response envelope and the decoded response. */
export async function get_notices_envelope(
  s: TestServer,
  client: Client = {},
): Promise<{ status: number; envelope: CoreContract.ResponseEnvelope | null; response: CoreContract.GetNoticesResponse | null }> {
  const request = new CoreContract.GetNoticesRequest();
  request.language = client.language ?? 'en';
  const headers = {
    'content-type': 'application/x-protobuf',
    'x-ogw-request-id': randomUUID(),
    'x-ogw-data-version': data_version(),
    'x-ogw-client-version': client.client_version ?? '1.0.0',
    'x-ogw-platform': client.platform ?? 'android',
  };
  const result = await send_raw(s, 'POST', '/core/GetNotices', headers, request.encode());
  const envelope = CoreContract.ResponseEnvelope.decode(result.body);
  const response = envelope !== null && envelope.error === null ? CoreContract.GetNoticesResponse.decode(envelope.body) : null;
  return { status: result.status, envelope, response };
}

/** `GetNotices` that must succeed. */
export async function get_notices(s: TestServer, client: Client = {}): Promise<CoreContract.GetNoticesResponse> {
  const { status, envelope, response } = await get_notices_envelope(s, client);
  if (status !== 200 || response === null) throw new Error(`GetNotices: HTTP ${String(status)}, error ${String(envelope?.error?.code)}`);
  return response;
}

/** The notice IDs `GetNotices` returns, in order. */
export async function shown_ids(s: TestServer, client: Client = {}): Promise<bigint[]> {
  return (await get_notices(s, client)).notices.map((n) => n.id);
}
