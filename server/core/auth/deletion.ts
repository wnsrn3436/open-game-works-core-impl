/**
 * Web account deletion (`### web account deletion`): `GET /account/deletion` and `POST /account/deletion`, routes
 * outside the request processing order. Page text is the page language's translation of the reserved strings.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as GameData from '../../generated/data/game_data.ts';
import { is_public_code_input } from '../storage/index.ts';
import { DELETION_CODE_CHARS } from './account.ts';
import { E, audit_log, deletion_url, error_log, security_log, truncated_ip, type AuthState } from './context.ts';
import type { Ctx } from './deps.ts';
import { timed } from './social.ts';
import { count_deletion_attempt, count_deletion_ip, delete_deletion_code, find_deletion_code, find_social_link } from './tables.ts';
import { sha256_hex } from './token.ts';
import { withdraw } from './withdraw.ts';

const MINUTE_MS = 60_000n;

/** A route request (`routing` `## API` route). */
export interface RouteRequest {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  /** Lower case header names. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** The body bytes; null when it passes `max_bytes` or the reading takes longer than `timeout_ms`. */
  read_body(max_bytes: number, timeout_ms: number): Promise<Uint8Array | null>;
}

export interface RouteResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

type TextName =
  | 'auth_deletion_title'
  | 'auth_deletion_body'
  | 'auth_deletion_user_id'
  | 'auth_deletion_code'
  | 'auth_deletion_confirm'
  | 'auth_deletion_submit'
  | 'auth_deletion_google'
  | 'auth_deletion_done'
  | 'auth_deletion_failed'
  | 'auth_deletion_retry'
  | 'auth_deletion_rate_limited'
  | 'auth_deletion_back';

function header(request: RouteRequest, name: string): string {
  return request.headers[name] ?? '';
}

/**
 * The page language: the first `Accept-Language` range (by q, then by order) with a supported language of the same
 * tag ignoring case; else the first range whose primary subtag a supported language shares; else the source
 * language.
 */
export function page_language(accept_language: string, supported: readonly string[], source: string): string {
  const ranges = accept_language
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p)?.[1]).find((v) => v !== undefined);
      return { tag: tag.trim().toLowerCase(), q: q === undefined ? 1 : Number(q), index };
    })
    .filter((r) => r.tag !== '' && r.tag !== '*' && Number.isFinite(r.q) && r.q > 0)
    .sort((x, y) => y.q - x.q || x.index - y.index);
  for (const range of ranges) {
    const exact = supported.find((s) => s.toLowerCase() === range.tag);
    if (exact !== undefined) return exact;
  }
  const primary = (tag: string): string => tag.toLowerCase().split('-')[0] ?? '';
  for (const range of ranges) {
    const near = supported.find((s) => primary(s) === primary(range.tag));
    if (near !== undefined) return near;
  }
  return source;
}

/** Page text lookup of one server instance; translation binaries are read once per language. */
export class PageText {
  private readonly cache = new Map<string, ReadonlyMap<string, string>>();
  private readonly a: AuthState;

  constructor(a: AuthState) {
    this.a = a;
  }

  text(language: string, name: TextName): string {
    const key = this.a.server.data.ReservedString[name]();
    let entries = this.cache.get(language);
    if (entries === undefined) {
      const file = this.a.server.read_data_file(`translation_${language.toLowerCase()}.bin`);
      entries = (file === null ? null : GameData.load_translation(file)) ?? new Map<string, string>();
      this.cache.set(language, entries);
    }
    return entries.get(key) ?? key;
  }
}

function escape_html(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${String(ch.charCodeAt(0))};`);
}

function html_response(status: number, nonce: string, body: string): RouteResponse {
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://accounts.google.com/gsi/client`,
    `style-src 'nonce-${nonce}' https://accounts.google.com/gsi/style`,
    'frame-src https://accounts.google.com/gsi/',
    'connect-src https://accounts.google.com/gsi/',
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
  return {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': csp,
    },
    body: new TextEncoder().encode(body),
  };
}

function document(language: string, nonce: string, title: string, main: string): string {
  return `<!doctype html><html lang="${escape_html(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape_html(title)}</title><style nonce="${nonce}">body{font-family:sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem}form{margin:1.5rem 0;display:grid;gap:.5rem}</style></head><body>${main}</body></html>`;
}

/** `GET /account/deletion`. */
export function deletion_page(a: AuthState, texts: PageText, request: RouteRequest): RouteResponse {
  const language = page_language(header(request, 'accept-language'), a.settings.supported_languages, a.settings.source_language);
  const t = (name: TextName): string => escape_html(texts.text(language, name));
  const nonce = randomBytes(16).toString('base64');
  const confirm = (id: string): string => `<label><input type="checkbox" name="confirm" value="yes" id="${id}"> ${t('auth_deletion_confirm')}</label>`;
  let main = `<h1>${t('auth_deletion_title')}</h1><p>${t('auth_deletion_body')}</p>`;
  main += `<form method="post" action="/account/deletion"><input type="hidden" name="method" value="code"><label>${t('auth_deletion_user_id')} <input name="public_code" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label><label>${t('auth_deletion_code')} <input name="code" autocomplete="off" required></label>${confirm('confirm_code')}<button type="submit">${t('auth_deletion_submit')}</button></form>`;
  const google = a.settings.adapter_google;
  if (google !== null) {
    main += `<form method="post" action="/account/deletion" id="google_form"><input type="hidden" name="method" value="google"><p>${t('auth_deletion_google')}</p>${confirm('confirm_google')}`;
    if (google === 'fake') {
      main += `<input name="credential" autocomplete="off" required><button type="submit">${t('auth_deletion_submit')}</button></form>`;
    } else {
      main += `<input type="hidden" name="credential" id="credential"></form><div id="g_id_onload" data-client_id="${escape_html(a.settings.google_server_client_id)}" data-callback="ogwGoogleCredential"></div><div class="g_id_signin"></div>`;
      main += `<script nonce="${nonce}">function ogwGoogleCredential(r){document.getElementById('credential').value=r.credential;document.getElementById('google_form').submit();}</script><script nonce="${nonce}" src="https://accounts.google.com/gsi/client" async></script>`;
    }
  }
  return html_response(200, nonce, document(language, nonce, texts.text(language, 'auth_deletion_title'), main));
}

function result_page(a: AuthState, texts: PageText, language: string, status: number, name: TextName): RouteResponse {
  const nonce = randomBytes(16).toString('base64');
  const main = `<p>${escape_html(texts.text(language, name))}</p><p><a href="${escape_html(deletion_url(a))}">${escape_html(texts.text(language, 'auth_deletion_back'))}</a></p>`;
  return html_response(status, nonce, document(language, nonce, texts.text(language, 'auth_deletion_title'), main));
}

export type DeletionForm = { readonly method: 'code'; readonly public_code: string; readonly code: string } | { readonly method: 'google'; readonly credential: string };

/** The fields of a form body; null when a field comes twice. */
function form_fields(body: string): Map<string, string> | null {
  const values = new Map<string, string>();
  for (const [name, value] of new URLSearchParams(body)) {
    if (values.has(name)) return null;
    values.set(name, value);
  }
  return values;
}

const FORM_FIELDS = { code: ['method', 'confirm', 'public_code', 'code'], google: ['method', 'confirm', 'credential'] } as const;

/** The `code` method form: a public code input of `storage` and a code of the deletion code characters. */
function code_form(values: ReadonlyMap<string, string>, code_length: number): DeletionForm | null {
  const public_code = values.get('public_code') ?? '';
  if (!is_public_code_input(public_code)) return null;
  const code = (values.get('code') ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!new RegExp(`^[${DELETION_CODE_CHARS}]{${String(code_length)}}$`).test(code)) return null;
  return { method: 'code', public_code, code };
}

/**
 * The form of a body: `method`, `confirm` (`yes`) and the method's fields, nothing else and no field twice. The
 * code is normalized (no spaces or `-`, upper case). Null when the form breaks a rule.
 */
export function parse_form(body: string, code_length: number, max_credential_bytes: number, google_enabled: boolean): DeletionForm | null {
  const values = form_fields(body);
  const method = values?.get('method');
  if (values === null || (method !== 'code' && method !== 'google')) return null;
  const allowed: readonly string[] = FORM_FIELDS[method];
  if (values.size !== allowed.length || [...values.keys()].some((k) => !allowed.includes(k))) return null;
  if (values.get('confirm') !== 'yes') return null;
  if (method === 'code') return code_form(values, code_length);
  const credential = values.get('credential') ?? '';
  if (!google_enabled || Buffer.byteLength(credential, 'utf8') > max_credential_bytes) return null;
  return { method, credential };
}

/** The identity check and withdrawal of steps 4 and 5. `retry` (500) has the cause its `error` log gives. */
type Outcome =
  | { readonly result: 'done' | 'fail' | 'unavailable'; readonly user_id: bigint | null }
  | { readonly result: 'retry'; readonly user_id: bigint | null; readonly cause: string };

/** The withdrawal of step 5 in the user's transaction; `INTERNAL` (rolled back) when a `remove_user` failed. */
function delete_account(a: AuthState, ctx: Ctx): 'pass' | number {
  return withdraw(a, ctx) === 'FAILED' ? E.CORE_ERROR_INTERNAL : 'pass';
}

/** Step 5 in the user's transaction, and what the transaction result means for the page. */
async function delete_in_transaction(a: AuthState, user_id: bigint, before: (ctx: Ctx) => boolean): Promise<Outcome> {
  const check = { passed: false };
  const committed = await a.modules.storage.run_user_transaction(user_id, (ctx) => {
    if (!before(ctx)) return 'pass';
    check.passed = true;
    return delete_account(a, ctx);
  });
  if (committed === 'WITHDRAWN') return { result: 'fail', user_id };
  if (committed === 'FAILED') return { result: 'retry', user_id, cause: 'run_user_transaction of the identity check is FAILED' };
  // REJECTED: a remove_user failed and the change function rolled the withdrawal back.
  if (committed === 'REJECTED') return { result: 'retry', user_id, cause: 'a remove_user is FAILED' };
  return { result: check.passed ? 'done' : 'fail', user_id };
}

/**
 * The `code` method: the user of the public code (read with `read_db`), then its transaction. A wrong code counts an
 * attempt and the last allowed attempt deletes the code.
 */
async function check_code(a: AuthState, form: Extract<DeletionForm, { method: 'code' }>): Promise<Outcome> {
  const { storage } = a.modules;
  let user_id: bigint | null;
  try {
    user_id = storage.find_user_by_public_code(storage.read_db(), form.public_code);
  } catch {
    return { result: 'retry', user_id: null, cause: 'the read_db lookup of the public code failed' };
  }
  if (user_id === null) return { result: 'fail', user_id: null };
  return delete_in_transaction(a, user_id, (ctx) => {
    const db = storage.db(ctx);
    const row = find_deletion_code(db, ctx.user_id);
    if (row === null || row.expires_at <= a.modules['server-time'].clock_now()) return false;
    const given = Buffer.from(sha256_hex(form.code), 'utf8');
    const stored = Buffer.from(row.code_hash, 'utf8');
    if (stored.length === given.length && timingSafeEqual(stored, given)) return true;
    const attempts = count_deletion_attempt(db, ctx.user_id);
    if (attempts >= a.settings.deletion_code_max_attempts) delete_deletion_code(db, ctx.user_id);
    return false;
  });
}

/** The `google` method: `verify` outside any transaction, the link row read with `read_db`, then the linked user's transaction. */
async function check_google(a: AuthState, form: Extract<DeletionForm, { method: 'google' }>, ip: string): Promise<Outcome> {
  const google = a.google;
  if (google === null) return { result: 'fail', user_id: null };
  const verified = await timed(a, (signal) => google.verify(form.credential, signal));
  if (!verified.ok) {
    if (verified.failure === 'rejected') return { result: 'fail', user_id: null };
    error_log(a, `login-google verify failed on the account deletion page: ${verified.failure}`, { request: 'POST /account/deletion' }, { ip: truncated_ip(ip) });
    return { result: 'unavailable', user_id: null };
  }
  let link: { user_id: bigint } | null;
  try {
    link = find_social_link(a.modules.storage.read_db(), 'LOGIN_PROVIDER_GOOGLE', verified.value);
  } catch {
    return { result: 'retry', user_id: null, cause: 'the read_db lookup of the auth_social_link row failed' };
  }
  if (link === null) return { result: 'fail', user_id: null };
  return delete_in_transaction(a, link.user_id, () => true);
}

function decode_utf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** `POST /account/deletion`. */
export async function deletion_post(a: AuthState, texts: PageText, request: RouteRequest, client_ip: string): Promise<RouteResponse> {
  const m = a.modules;
  const language = page_language(header(request, 'accept-language'), a.settings.supported_languages, a.settings.source_language);
  const page = (status: number, name: TextName): RouteResponse => result_page(a, texts, language, status, name);
  const target = { request: 'POST /account/deletion' };
  const now = m['server-time'].clock_now();
  const window_start = m['server-time'].get_window_start(MINUTE_MS, now);
  const count = await m.storage.run_game_transaction((tx) => count_deletion_ip(m.storage.db(tx), client_ip, window_start, window_start + MINUTE_MS));
  if (count === 'FAILED') {
    error_log(a, 'account deletion failed: run_game_transaction of the IP limit is FAILED', target, { ip: truncated_ip(client_ip) });
    return page(500, 'auth_deletion_retry');
  }
  if (count > BigInt(a.settings.deletion_attempts_per_minute)) {
    security_log(a, 'account deletion attempts over the IP limit', target, 'rate_limited_ip', client_ip);
    return page(429, 'auth_deletion_rate_limited');
  }
  const media = header(request, 'content-type').split(';')[0]?.trim().toLowerCase();
  const body = media === 'application/x-www-form-urlencoded' ? await request.read_body(a.settings.max_body_bytes, Number(a.settings.body_read_timeout_ms)) : null;
  const text = body === null ? null : decode_utf8(body);
  const form = text === null ? null : parse_form(text, a.settings.deletion_code_length, a.settings.max_credential_bytes, a.settings.adapter_google !== null);
  if (form === null) return page(400, 'auth_deletion_failed');
  if (m['admin-api'].is_maintenance()) return page(503, 'auth_deletion_retry');
  const outcome = form.method === 'code' ? await check_code(a, form) : await check_google(a, form, client_ip);
  const who = { ...target, user_id: outcome.user_id };
  if (outcome.result === 'fail') {
    security_log(a, 'account deletion identity check failed', who, 'deletion_identity', client_ip, { method: form.method });
    return page(403, 'auth_deletion_failed');
  }
  if (outcome.result === 'unavailable') return page(502, 'auth_deletion_retry');
  if (outcome.result === 'retry') {
    error_log(a, `account deletion failed: ${outcome.cause}`, who, { method: form.method });
    return page(500, 'auth_deletion_retry');
  }
  audit_log(a, 'account deleted on the web account deletion page', who, { reason: 'web_deletion', method: form.method, ip: truncated_ip(client_ip) });
  return page(200, 'auth_deletion_done');
}
