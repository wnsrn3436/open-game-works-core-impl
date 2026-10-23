/** HTTP replies of admin requests: 200 with the output JSON, or the failure's status with `{"error":"<reason>"}`. */
import { output_json, utf8_bytes } from './json.ts';
import type { AdminOutput } from './types.ts';

export type FailureReason =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'too_large'
  | 'rate_limited'
  | 'internal'
  | 'external_failed';

const STATUS: Readonly<Record<FailureReason, number>> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  rate_limited: 429,
  internal: 500,
  external_failed: 502,
};

const JSON_TYPE = 'application/json';

export class Reply {
  readonly status: number;
  /** The failure reason; null on success. */
  readonly error: FailureReason | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;

  constructor(status: number, error: FailureReason | null, headers: Readonly<Record<string, string>>, body: Uint8Array) {
    this.status = status;
    this.error = error;
    this.headers = headers;
    this.body = body;
  }
}

/** 200 with an output JSON object. */
export function ok(output: AdminOutput): Reply {
  return ok_text(JSON.stringify(output_json(output)));
}

/** 200 with output JSON text as it was stored. */
export function ok_text(text: string): Reply {
  return new Reply(200, null, { 'Content-Type': JSON_TYPE }, utf8_bytes(text));
}

/** The failure's status with `{"error":"<reason>"}` and, when given, more fields. */
export function fail(reason: FailureReason, extra: AdminOutput = {}): Reply {
  return new Reply(STATUS[reason], reason, { 'Content-Type': JSON_TYPE }, utf8_bytes(JSON.stringify(output_json({ error: reason, ...extra }))));
}

/** 200 with a JSON file to save. */
export function file(name: string, text: string): Reply {
  return new Reply(200, null, { 'Content-Type': JSON_TYPE, 'Content-Disposition': `attachment; filename="${name}"` }, utf8_bytes(text));
}
