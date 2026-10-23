/**
 * The token-less core `rpc`s `Login`, `AutoLogin`, `RefreshToken`, `GetTerms` and the part of `DevLogin` they share
 * (`### Login`, `### AutoLogin`, `### token`).
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import { provider_name } from './consent.ts';
import {
  E,
  deletion_url,
  empty_delta,
  failure,
  is_error,
  note_unknown_kinds,
  refresh_consent,
  request_fields,
  security_log,
  token_key,
  type AuthState,
  type TokenlessInput,
  type TokenlessOutput,
} from './context.ts';
import type { CoreErrorCode, Ctx, DbHandle, ResponseDelta } from './deps.ts';
import { adapter_of, social_provider, verify_credential, type SocialAccount } from './social.ts';
import {
  delete_login_token,
  delete_next_login_tokens,
  find_login_token,
  find_social_link,
  has_agreement,
  insert_agreement,
  insert_login_token,
  insert_social_link,
  linked_providers,
  touch_login_token,
  upsert_apple_token,
  type LoginTokenRow,
} from './tables.ts';
import { new_login_token, sha256_hex, sign_access_token } from './token.ts';

const TERMS_ITEMS = [
  ['TERMS_ITEM_TERMS', CoreContract.TermsItem.TERMS_ITEM_TERMS, 'TERMS'],
  ['TERMS_ITEM_PRIVACY', CoreContract.TermsItem.TERMS_ITEM_PRIVACY, 'PRIVACY'],
] as const;

/** The terms documents of `GetTerms`: `TERMS`, `PRIVACY` with their current version and URL. */
export function terms_documents(a: AuthState): CoreContract.TermsDocument[] {
  return TERMS_ITEMS.map(([, item, key]) => Object.assign(new CoreContract.TermsDocument(), { item, version: a.settings.terms[key].version, url: a.settings.terms[key].url }));
}

/**
 * `Login` step 1: `INVALID_REQUEST` when an item is not `TERMS` or `PRIVACY` or an item comes twice;
 * `CONSENT_REQUIRED` when an item's agreed version is not its current version; null when the list passes.
 */
export function agreements_error(a: AuthState, agreements: readonly CoreContract.TermsAgreement[]): CoreErrorCode | null {
  const seen = new Set<number>();
  for (const agreement of agreements) {
    if (!TERMS_ITEMS.some(([, item]) => item === agreement.item) || seen.has(agreement.item)) return E.CORE_ERROR_INVALID_REQUEST;
    seen.add(agreement.item);
  }
  for (const [, item, key] of TERMS_ITEMS) {
    if (agreements.find((x) => x.item === item)?.version !== a.settings.terms[key].version) return E.CORE_ERROR_CONSENT_REQUIRED;
  }
  return null;
}

function stored_agreements_error(a: AuthState, db: DbHandle, user_id: bigint): CoreErrorCode | null {
  for (const [name, , key] of TERMS_ITEMS) {
    if (!has_agreement(db, user_id, name, a.settings.terms[key].version)) return E.CORE_ERROR_CONSENT_REQUIRED;
  }
  return null;
}

/** A new user made in one game transaction; null when the transaction failed. */
export async function create_user(a: AuthState): Promise<bigint | null> {
  const { storage } = a.modules;
  const created = await storage.run_game_transaction((tx) => storage.create_user(tx));
  return created === 'FAILED' ? null : created;
}

/**
 * Inserts a row that maps a key to a new user unless the key has one, in the new user's transaction: when the key
 * re-read there is another user's, the new user is deleted in that transaction. Returns the key's user, or null
 * when the transaction failed.
 */
export async function claim_key(a: AuthState, new_user: bigint, insert: (db: DbHandle, ctx: Ctx) => void, read: (db: DbHandle) => bigint | null): Promise<bigint | null> {
  const { storage } = a.modules;
  let owner: bigint | null = null;
  const result = await storage.run_user_transaction(new_user, (ctx) => {
    const db = storage.db(ctx);
    insert(db, ctx);
    owner = read(db);
    if (owner !== new_user) storage.delete_user(ctx);
    return 'pass' as const;
  });
  return result === 'COMMITTED' ? owner : null;
}

export type LoginKind = 'core/Login' | 'core/AutoLogin' | 'core/cheat/DevLogin';

/** What steps 4 to 7 need besides the user. */
export interface LoginPlan {
  readonly kind: LoginKind;
  readonly user_id: bigint;
  /** True when this request made the user (`core_user_created`); `provider` is then its provider. */
  readonly created: boolean;
  readonly provider: CoreContract.LoginProvider;
  /** Agreements to record: (item element name, version). */
  readonly agreements: readonly (readonly [string, number])[];
  /** The Apple refresh token to keep. */
  readonly apple_refresh_token: string | null;
  /** `AutoLogin`: the hash of the requested login token. */
  readonly token_hash: string | null;
}

/**
 * The ban login: a new session and its access token in one request transaction, without a login token, request
 * start or agreements, answered with `BANNED`.
 */
async function ban_login(a: AuthState, input: TokenlessInput<unknown>, plan: LoginPlan, until_at: bigint): Promise<TokenlessOutput<never>> {
  const { storage, session } = a.modules;
  let used: Ctx | null = null;
  const opened = await storage.run_request_transaction(plan.user_id, request_fields(plan.kind, input), (ctx) => {
    used = ctx;
    const { session_id, signing_key } = session.start_session(ctx);
    return { session_id, signing_key, expires_at: ctx.request_time + a.settings.access_token_ttl_ms };
  });
  if (opened === 'WITHDRAWN') return failure(E.CORE_ERROR_UNAUTHORIZED, plan.user_id, used);
  if (opened === 'FAILED') return failure(E.CORE_ERROR_INTERNAL, plan.user_id, used);
  const ban = Object.assign(new CoreContract.BanDetail(), {
    user_id: plan.user_id,
    until_at,
    deletion_url: deletion_url(a),
    access_token: sign_access_token(token_key(a), plan.user_id, opened.session_id, opened.expires_at),
    session_signing_key: opened.signing_key,
  });
  return { ok: false, error: E.CORE_ERROR_BANNED, ban, user_id: plan.user_id, ctx: used };
}

/** Steps 4 to 7 of `Login` (also of `AutoLogin` and `DevLogin`): ban, request start, the login transaction. */
export async function complete_login(a: AuthState, input: TokenlessInput<unknown>, plan: LoginPlan): Promise<TokenlessOutput<CoreContract.AuthResult>> {
  const m = a.modules;
  const ban = m['admin-api'].is_banned(plan.user_id);
  if (ban.banned) return ban_login(a, input, plan, ban.until_at);
  for (const module of [m['live-event'], m.mailbox, m['public-profile']]) {
    if (module !== undefined) await module.on_request_start(plan.user_id);
  }
  let used: Ctx | null = null;
  const result = await m.storage.run_request_transaction(plan.user_id, request_fields(plan.kind, input), (ctx) => {
    used = ctx;
    return login_transaction(a, ctx, plan);
  });
  if (result === 'WITHDRAWN') return failure(E.CORE_ERROR_UNAUTHORIZED, plan.user_id, used);
  if (result === 'FAILED') return failure(E.CORE_ERROR_INTERNAL, plan.user_id, used);
  if (is_error(result)) return failure(result, plan.user_id, used);
  return { ok: true, response: result.response, delta: result.delta, user_id: plan.user_id, ctx: used };
}

/**
 * The rotation step `AutoLogin` and `RefreshToken` share: the requested row R gets `last_used_at` at the request time
 * (and `session_id` when given) and the row R's `previous_hash` points to is deleted.
 */
function use_login_token(db: DbHandle, ctx: Ctx, row: LoginTokenRow, session_id: string | null): void {
  touch_login_token(db, row.token_hash, ctx.request_time, session_id);
  if (row.previous_hash !== null) delete_login_token(db, row.previous_hash);
}

/** `AutoLogin`'s rotation: the shared step with the new session, then R's unused next tokens are deleted. */
function rotate(a: AuthState, ctx: Ctx, token_hash: string, session_id: string): string | CoreErrorCode {
  const db = a.modules.storage.db(ctx);
  const row = find_login_token(db, token_hash);
  if (row === null || row.user_id !== ctx.user_id) return E.CORE_ERROR_UNAUTHORIZED;
  use_login_token(db, ctx, row, session_id);
  delete_next_login_tokens(db, ctx.user_id, token_hash);
  return token_hash;
}

function login_transaction(a: AuthState, ctx: Ctx, plan: LoginPlan): { response: CoreContract.AuthResult; delta: ResponseDelta } | CoreErrorCode {
  const m = a.modules;
  const db = m.storage.db(ctx);
  if (plan.token_hash !== null && find_login_token(db, plan.token_hash) === null) return E.CORE_ERROR_UNAUTHORIZED;
  for (const [item, version] of plan.agreements) insert_agreement(db, ctx.user_id, item, version, ctx.request_time);
  const consent = refresh_consent(a, ctx);
  if (consent.below_minimum_age) return E.CORE_ERROR_AGE_BELOW_MINIMUM;
  if (plan.apple_refresh_token !== null) upsert_apple_token(db, ctx.user_id, plan.apple_refresh_token, ctx.request_time);
  if (plan.created) m.logging.track_core_event(ctx, 'core_user_created', [['provider', provider_name(plan.provider)]]);
  m.logging.track_core_event(ctx, 'core_session_started', [['login', plan.kind]]);
  const session = m.session.start_session(ctx);
  let previous_hash: string | null = null;
  if (plan.token_hash !== null) {
    const rotated = rotate(a, ctx, plan.token_hash, session.session_id);
    if (is_error(rotated)) return rotated;
    previous_hash = rotated;
  }
  const login_token = new_login_token();
  insert_login_token(db, { user_id: ctx.user_id, token_hash: sha256_hex(login_token), previous_hash, session_id: session.session_id, created_at: ctx.request_time, last_used_at: ctx.request_time });
  const full = m.storage.read_full_state(ctx);
  note_unknown_kinds(a, ctx, full.unknown_kinds);
  const response = auth_result(a, ctx, { login_token, session, consent });
  return { response, delta: m.storage.take_response_delta(ctx).delta };
}

/** The `AuthResult` of a login transaction (step 7). */
function auth_result(
  a: AuthState,
  ctx: Ctx,
  made: { login_token: string; session: { session_id: string; signing_key: string }; consent: CoreContract.ConsentUserState },
): CoreContract.AuthResult {
  const m = a.modules;
  const db = m.storage.db(ctx);
  const remote = m['remote-config'] === undefined ? null : m['remote-config'].get_client_config(ctx);
  const record = m.storage.get_user_record(db, ctx.user_id);
  const expires_at = ctx.request_time + a.settings.access_token_ttl_ms;
  return Object.assign(new CoreContract.AuthResult(), {
    user_id: ctx.user_id,
    user_created_at: record?.created_at ?? 0n,
    login_token: made.login_token,
    access_token: sign_access_token(token_key(a), ctx.user_id, made.session.session_id, expires_at),
    access_token_expires_at: expires_at,
    session_signing_key: made.session.signing_key,
    linked_providers: provider_values(db, ctx.user_id),
    consent: made.consent,
    remote_config: Object.assign(new CoreContract.GetRemoteConfigResponse(), { entries: [...(remote?.entries ?? [])], assignments: [...(remote?.assignments ?? [])] }),
  });
}

/** The user's linked providers as `LoginProvider` values. */
export function provider_values(db: DbHandle, user_id: bigint): CoreContract.LoginProvider[] {
  const values: Readonly<Record<string, CoreContract.LoginProvider>> = {
    LOGIN_PROVIDER_APPLE: CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE,
    LOGIN_PROVIDER_GOOGLE: CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE,
  };
  return linked_providers(db, user_id).flatMap((name) => {
    const value = values[name];
    return value === undefined ? [] : [value];
  });
}

function wrap<Res extends { result: CoreContract.AuthResult | null }>(make: () => Res, output: TokenlessOutput<CoreContract.AuthResult>): TokenlessOutput<Res> {
  if (!output.ok) return output;
  return { ...output, response: Object.assign(make(), { result: output.response }) };
}

function agreed(agreements: readonly CoreContract.TermsAgreement[]): [string, number][] {
  return agreements.map((x) => [x.item === CoreContract.TermsItem.TERMS_ITEM_TERMS ? 'TERMS_ITEM_TERMS' : 'TERMS_ITEM_PRIVACY', x.version]);
}

/** The user of a social account: the linked user, or a new user that this request links when it wins the key. */
async function social_user(a: AuthState, account: SocialAccount): Promise<{ user_id: bigint; created: boolean } | null> {
  const { storage } = a.modules;
  const linked = find_social_link(storage.read_db(), account.provider, account.account_id);
  if (linked !== null) return { user_id: linked.user_id, created: false };
  const new_user = await create_user(a);
  if (new_user === null) return null;
  const owner = await claim_key(
    a,
    new_user,
    (db, ctx) => {
      insert_social_link(db, new_user, account.provider, account.account_id, ctx.request_time);
    },
    (db) => find_social_link(db, account.provider, account.account_id)?.user_id ?? null,
  );
  return owner === null ? null : { user_id: owner, created: owner === new_user };
}

/** `Login`. */
export async function login(a: AuthState, input: TokenlessInput<CoreContract.LoginRequest>): Promise<TokenlessOutput<CoreContract.LoginResponse>> {
  const request = input.request;
  const terms = agreements_error(a, request.agreements);
  if (terms !== null) return failure(terms);
  const provider = request.provider;
  let user: { user_id: bigint; created: boolean } | null;
  let apple_refresh_token: string | null = null;
  if (provider === CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST) {
    if (request.credential !== '') return failure(E.CORE_ERROR_INVALID_REQUEST);
    const new_user = await create_user(a);
    user = new_user === null ? null : { user_id: new_user, created: true };
  } else {
    const social = social_provider(provider);
    if (social === null || adapter_of(a, social) === null) return failure(E.CORE_ERROR_INVALID_REQUEST);
    const account = await verify_credential(a, social, request.credential, { user_id: null, request_id: input.request_id, request: 'core/Login', ip: input.client_ip });
    if (is_error(account)) return failure(account);
    apple_refresh_token = account.refresh_token;
    user = await social_user(a, account);
  }
  if (user === null) return failure(E.CORE_ERROR_INTERNAL);
  const plan: LoginPlan = { kind: 'core/Login', user_id: user.user_id, created: user.created, provider, agreements: agreed(request.agreements), apple_refresh_token, token_hash: null };
  return wrap(() => new CoreContract.LoginResponse(), await complete_login(a, input, plan));
}

function unknown_login_token(a: AuthState, input: TokenlessInput<unknown>, request: string): TokenlessOutput<never> {
  security_log(a, 'unknown login token', { request_id: input.request_id, request }, 'unauthorized', input.client_ip);
  return failure(E.CORE_ERROR_UNAUTHORIZED);
}

/** `AutoLogin`. */
export async function auto_login(a: AuthState, input: TokenlessInput<CoreContract.AutoLoginRequest>): Promise<TokenlessOutput<CoreContract.AutoLoginResponse>> {
  const token_hash = sha256_hex(input.authorization);
  const read = a.modules.storage.read_db();
  const row = input.authorization === '' ? null : find_login_token(read, token_hash);
  if (row === null) return unknown_login_token(a, input, 'core/AutoLogin');
  const agreements = input.request.agreements;
  const terms = agreements.length > 0 ? agreements_error(a, agreements) : stored_agreements_error(a, read, row.user_id);
  if (terms !== null) return failure(terms, row.user_id);
  const plan: LoginPlan = {
    kind: 'core/AutoLogin',
    user_id: row.user_id,
    created: false,
    provider: CoreContract.LoginProvider.LOGIN_PROVIDER_UNSPECIFIED,
    agreements: agreed(agreements),
    apple_refresh_token: null,
    token_hash,
  };
  return wrap(() => new CoreContract.AutoLoginResponse(), await complete_login(a, input, plan));
}

/** `RefreshToken`. */
export async function refresh_token(a: AuthState, input: TokenlessInput<CoreContract.RefreshTokenRequest>): Promise<TokenlessOutput<CoreContract.RefreshTokenResponse>> {
  const { storage, session } = a.modules;
  const token_hash = sha256_hex(input.authorization);
  const row = input.authorization === '' ? null : find_login_token(storage.read_db(), token_hash);
  if (row === null) return unknown_login_token(a, input, 'core/RefreshToken');
  const target = { user_id: row.user_id, request_id: input.request_id, request: 'core/RefreshToken' };
  const current = session.check_current(row.user_id, row.session_id);
  if (current !== 'pass') {
    security_log(a, 'login token of a session that is not current', target, current === E.CORE_ERROR_SESSION_REPLACED ? 'session_replaced' : 'unauthorized', input.client_ip);
    return failure(current, row.user_id);
  }
  const signed = session.verify_signature(row.user_id, row.session_id, 'core/RefreshToken', input.request_id, input.timestamp, input.signature, input.body);
  if (signed !== 'pass') {
    if (signed === E.CORE_ERROR_SESSION_REPLACED) security_log(a, 'login token of a session that is not current', target, 'session_replaced', input.client_ip);
    else security_log(a, 'request signature check failed', target, 'unauthorized', input.client_ip);
    return failure(signed, row.user_id);
  }
  let used: Ctx | null = null;
  const result = await storage.run_request_transaction(row.user_id, request_fields('core/RefreshToken', input, { session_id: row.session_id }), (ctx) => {
    used = ctx;
    const db = storage.db(ctx);
    const again = find_login_token(db, token_hash);
    if (again === null) return E.CORE_ERROR_UNAUTHORIZED;
    use_login_token(db, ctx, again, null);
    const expires_at = ctx.request_time + a.settings.access_token_ttl_ms;
    const response = Object.assign(new CoreContract.RefreshTokenResponse(), {
      access_token: sign_access_token(token_key(a), ctx.user_id, again.session_id, expires_at),
      access_token_expires_at: expires_at,
    });
    const taken = storage.take_response_delta(ctx);
    note_unknown_kinds(a, ctx, taken.unknown_kinds);
    return { response, delta: taken.delta };
  });
  if (result === 'WITHDRAWN') return failure(E.CORE_ERROR_UNAUTHORIZED, row.user_id, used);
  if (result === 'FAILED') return failure(E.CORE_ERROR_INTERNAL, row.user_id, used);
  if (is_error(result)) return failure(result, row.user_id, used);
  return { ok: true, response: result.response, delta: result.delta, user_id: row.user_id, ctx: used };
}

/** `GetTerms`: no user and no transaction. */
export function get_terms(a: AuthState): TokenlessOutput<CoreContract.GetTermsResponse> {
  const response = Object.assign(new CoreContract.GetTermsResponse(), { documents: terms_documents(a) });
  return { ok: true, response, delta: empty_delta(), user_id: null, ctx: null };
}
