/**
 * The core `rpc`s that go through `routing`'s request processing order (`Logout`, `LinkAccount`, `Withdraw`,
 * `IssueDeletionCode`, `ConfirmAge`, `UpdateConsent`, `UpdatePushConsent`) and the internal operations
 * `verify_access_token` and `prepare_link_account`.
 */
import { randomInt } from 'node:crypto';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import { birth_year_month_valid, choice_name, tracking_name, utc_year_month } from './consent.ts';
import { E, audit_log, deletion_url, refresh_consent, token_key, type AuthState } from './context.ts';
import type { CoreErrorCode, Ctx } from './deps.ts';
import { provider_values } from './login.ts';
import { adapter_of, social_provider, verify_credential, type SocialAccount } from './social.ts';
import {
  append_consent_records,
  birth_year_month,
  delete_login_token,
  find_social_link,
  insert_age,
  insert_social_link,
  linked_providers,
  login_tokens_of_session,
  upsert_apple_token,
  upsert_deletion_code,
  type ConsentRecord,
} from './tables.ts';
import { read_access_token, sha256_hex } from './token.ts';
import { withdraw } from './withdraw.ts';

/** The characters of a deletion code. */
export const DELETION_CODE_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `verify_access_token`: (user ID, session ID), `UNAUTHORIZED` or `TOKEN_EXPIRED`. */
export function verify_access_token(a: AuthState, token: string): { readonly user_id: bigint; readonly session_id: string } | CoreErrorCode {
  if (Buffer.byteLength(token, 'utf8') > a.settings.max_token_bytes) return E.CORE_ERROR_UNAUTHORIZED;
  const claims = read_access_token(token_key(a), token);
  if (claims === 'invalid') return E.CORE_ERROR_UNAUTHORIZED;
  const now = a.modules['server-time'].user_now(claims.user_id, a.modules.storage.read_db());
  if (now >= claims.expires_at) return E.CORE_ERROR_TOKEN_EXPIRED;
  return { user_id: claims.user_id, session_id: claims.session_id };
}

/** `Logout`: ends the session and deletes the login token rows of that session and the rows they follow. */
export function logout(a: AuthState, ctx: Ctx): CoreContract.LogoutResponse {
  const { storage, session } = a.modules;
  const db = storage.db(ctx);
  for (const row of login_tokens_of_session(db, ctx.user_id, ctx.session_id)) {
    delete_login_token(db, row.token_hash);
    if (row.previous_hash !== null) delete_login_token(db, row.previous_hash);
  }
  session.end_session(ctx);
  return new CoreContract.LogoutResponse();
}

/** `prepare_link_account`: the social account of the credential, checked outside the transaction. */
export async function prepare_link_account(a: AuthState, user_id: bigint, request: CoreContract.LinkAccountRequest, client_ip: string): Promise<SocialAccount | CoreErrorCode> {
  const social = social_provider(request.provider);
  if (social === null || adapter_of(a, social) === null) return E.CORE_ERROR_INVALID_REQUEST;
  return verify_credential(a, social, request.credential, { user_id, request_id: null, request: 'core/LinkAccount', ip: client_ip });
}

/** `LinkAccount` with the prepare value of `prepare_link_account`. */
export function link_account(a: AuthState, ctx: Ctx, account: SocialAccount): CoreContract.LinkAccountResponse | CoreErrorCode {
  const db = a.modules.storage.db(ctx);
  if (linked_providers(db, ctx.user_id).includes(account.provider)) return E.CORE_ERROR_ALREADY_LINKED;
  insert_social_link(db, ctx.user_id, account.provider, account.account_id, ctx.request_time);
  if (find_social_link(db, account.provider, account.account_id)?.user_id !== ctx.user_id) return E.CORE_ERROR_ALREADY_LINKED;
  if (account.refresh_token !== null) upsert_apple_token(db, ctx.user_id, account.refresh_token, ctx.request_time);
  return Object.assign(new CoreContract.LinkAccountResponse(), { linked_providers: provider_values(db, ctx.user_id) });
}

/** `Withdraw`. */
export function withdraw_request(a: AuthState, ctx: Ctx): CoreContract.WithdrawResponse | CoreErrorCode {
  return withdraw(a, ctx) === 'FAILED' ? E.CORE_ERROR_INTERNAL : new CoreContract.WithdrawResponse();
}

/** `IssueDeletionCode`. */
export function issue_deletion_code(a: AuthState, ctx: Ctx): CoreContract.IssueDeletionCodeResponse {
  let code = '';
  for (let i = 0; i < a.settings.deletion_code_length; i += 1) code += DELETION_CODE_CHARS[randomInt(DELETION_CODE_CHARS.length)] as string;
  const expires_at = ctx.request_time + a.settings.deletion_code_ttl_ms;
  upsert_deletion_code(a.modules.storage.db(ctx), ctx.user_id, sha256_hex(code), expires_at);
  return Object.assign(new CoreContract.IssueDeletionCodeResponse(), { code, expires_at, url: deletion_url(a) });
}

function consent_response<T extends { consent: CoreContract.ConsentUserState | null }>(make: () => T, consent: CoreContract.ConsentUserState): T {
  return Object.assign(make(), { consent });
}

/** `ConfirmAge`. A user below `consent.minimumAge` is withdrawn in the same transaction. */
export function confirm_age(a: AuthState, ctx: Ctx, request: CoreContract.ConfirmAgeRequest): CoreContract.ConfirmAgeResponse | CoreErrorCode {
  const { storage } = a.modules;
  const now_year_month = utc_year_month(a.modules['server-time'].clock_now());
  if (!birth_year_month_valid(request.birth_year_month, now_year_month, a.settings.max_age_years)) return E.CORE_ERROR_INVALID_REQUEST;
  const db = storage.db(ctx);
  const stored = storage.get_state(ctx, CoreContract.ConsentUserState, 0n);
  if (birth_year_month(db, ctx.user_id) !== null && stored !== null && stored.age_confirmed_at !== 0n) {
    return consent_response(() => new CoreContract.ConfirmAgeResponse(), stored);
  }
  insert_age(db, ctx.user_id, request.birth_year_month, ctx.request_time);
  const consent = refresh_consent(a, ctx, (state) => {
    state.age_confirmed_at = ctx.request_time;
  });
  if (consent.below_minimum_age) {
    if (withdraw(a, ctx) === 'FAILED') return E.CORE_ERROR_INTERNAL;
    const target = { user_id: ctx.user_id, request_id: ctx.request_id, request: 'core/ConfirmAge' };
    storage.after_commit(ctx, () => {
      audit_log(a, 'user below the minimum age withdrawn', target, { reason: 'age_blocked' });
    });
  }
  return consent_response(() => new CoreContract.ConfirmAgeResponse(), consent);
}

const CHOICES: readonly number[] = [CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED, CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED];
const TRACKING: readonly number[] = Object.values(CoreContract.TrackingStatus).filter((v) => v !== CoreContract.TrackingStatus.TRACKING_STATUS_UNSPECIFIED);

/** The `UpdateConsent` input rules of `consent.privacyChoices`. */
function consent_input_valid(a: AuthState, request: CoreContract.UpdateConsentRequest): boolean {
  if (request.privacy_version !== a.settings.consent_version || !TRACKING.includes(request.tracking)) return false;
  if (a.settings.privacy_choices) return CHOICES.includes(request.ad_personalization) && CHOICES.includes(request.analytics);
  const unspecified = CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED;
  return request.analytics === unspecified && (request.ad_personalization === unspecified || CHOICES.includes(request.ad_personalization));
}

/** `UpdateConsent`: a record per changed item, in the order `ad_personalization`, `analytics`, `tracking`. */
export function update_consent(a: AuthState, ctx: Ctx, request: CoreContract.UpdateConsentRequest): CoreContract.UpdateConsentResponse | CoreErrorCode {
  if (!consent_input_valid(a, request)) return E.CORE_ERROR_INVALID_REQUEST;
  const records: ConsentRecord[] = [];
  const consent = refresh_consent(a, ctx, (state) => {
    const version = request.privacy_version;
    if (state.ad_personalization !== request.ad_personalization) records.push({ purpose: 'ad_personalization', value: choice_name(request.ad_personalization), version });
    if (state.analytics !== request.analytics) records.push({ purpose: 'analytics', value: choice_name(request.analytics), version });
    if (state.tracking !== request.tracking) records.push({ purpose: 'tracking', value: tracking_name(request.tracking), version });
    state.privacy_version = version;
    state.ad_personalization = request.ad_personalization;
    state.analytics = request.analytics;
    state.tracking = request.tracking;
  });
  append_consent_records(a.modules.storage.db(ctx), ctx.user_id, records, ctx.request_time);
  return consent_response(() => new CoreContract.UpdateConsentResponse(), consent);
}

/** `UpdatePushConsent`: each changed item gets its `_at` and a record, then `push.refresh_push_consent`. */
export function update_push_consent(a: AuthState, ctx: Ctx, request: CoreContract.UpdatePushConsentRequest): CoreContract.UpdatePushConsentResponse | CoreErrorCode {
  if (!a.settings.ad_push || !CHOICES.includes(request.push_ad) || !CHOICES.includes(request.push_night)) return E.CORE_ERROR_INVALID_REQUEST;
  const records: ConsentRecord[] = [];
  const consent = refresh_consent(a, ctx, (state) => {
    if (state.push_ad !== request.push_ad) {
      state.push_ad = request.push_ad;
      state.push_ad_at = ctx.request_time;
      records.push({ purpose: 'push_ad', value: choice_name(request.push_ad), version: 0 });
    }
    if (state.push_night !== request.push_night) {
      state.push_night = request.push_night;
      state.push_night_at = ctx.request_time;
      records.push({ purpose: 'push_night', value: choice_name(request.push_night), version: 0 });
    }
  });
  append_consent_records(a.modules.storage.db(ctx), ctx.user_id, records, ctx.request_time);
  if (a.modules.push !== undefined) a.modules.push.refresh_push_consent(ctx);
  return consent_response(() => new CoreContract.UpdatePushConsentResponse(), consent);
}
