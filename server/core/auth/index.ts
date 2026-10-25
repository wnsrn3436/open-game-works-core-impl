/**
 * `auth`: accounts and login (`server-core` `## module`). `create_auth` makes the module object of one server
 * instance. It holds the core `rpc` handlers, the routes and the admin operations auth exports for `routing`, the
 * internal operations `verify_access_token` and `prepare_link_account`, and the lifecycle methods.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import {
  confirm_age,
  issue_deletion_code,
  link_account,
  logout,
  prepare_link_account,
  update_consent,
  update_push_consent,
  verify_access_token,
  withdraw_request,
} from './account.ts';
import { admin_operations, type AdminOperation } from './admin.ts';
import { url_key_source, type AppleAdapter, type GoogleAdapter } from './adapters/common.ts';
import { APPLE_JWKS_URL, create_login_apple } from './adapters/login_apple.ts';
import { GOOGLE_JWKS_URL, create_login_google } from './adapters/login_google.ts';
import { error_log, tokenless_input, type AuthState, type RoutingTokenlessInput, type TokenlessOutput } from './context.ts';
import { deletion_page, deletion_post, PageText, type RouteRequest, type RouteResponse } from './deletion.ts';
import type { AuthInput, CoreErrorCode, Ctx, SocialAdapterKey } from './deps.ts';
import { guest_sweep_job } from './guest_sweep.ts';
import { auto_login, get_terms, login, refresh_token } from './login.ts';
import { read_settings, settings_errors } from './settings.ts';
import type { SocialAccount } from './social.ts';
import { TABLES, has_social_link, register, type TableDefinition } from './tables.ts';
import { auth_server } from './server_view.ts';
import { access_token_key } from './token.ts';

export type { AuthInput, AuthServerInput } from './deps.ts';
export type { RoutingTokenlessInput, TokenlessInput, TokenlessOutput } from './context.ts';
export { web_deletion_url } from './context.ts';
export type { RouteRequest, RouteResponse } from './deletion.ts';
export type { AdminOperation } from './admin.ts';
export type { SocialAccount } from './social.ts';

/** What the DEV code fills in before server start (`dev/index.ts`). */
export interface AuthDevSlot {
  /** Tables only the DEV code uses. */
  readonly tables: readonly TableDefinition[];
  /** Makes the fake adapter of a service when the instance has no fake adapter override. */
  readonly fake_adapter: (service: SocialAdapterKey) => AppleAdapter & GoogleAdapter;
}

type Tokenless<Req, Res> = (input: RoutingTokenlessInput<Req>) => Promise<TokenlessOutput<Res>>;

export interface Auth {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;

  Login: Tokenless<CoreContract.LoginRequest, CoreContract.LoginResponse>;
  AutoLogin: Tokenless<CoreContract.AutoLoginRequest, CoreContract.AutoLoginResponse>;
  RefreshToken: Tokenless<CoreContract.RefreshTokenRequest, CoreContract.RefreshTokenResponse>;
  GetTerms: Tokenless<CoreContract.GetTermsRequest, CoreContract.GetTermsResponse>;

  Logout(ctx: Ctx, request: CoreContract.LogoutRequest): CoreContract.LogoutResponse;
  LinkAccount(ctx: Ctx, request: CoreContract.LinkAccountRequest, prepare: SocialAccount): CoreContract.LinkAccountResponse | CoreErrorCode;
  Withdraw(ctx: Ctx, request: CoreContract.WithdrawRequest): CoreContract.WithdrawResponse | CoreErrorCode;
  IssueDeletionCode(ctx: Ctx, request: CoreContract.IssueDeletionCodeRequest): CoreContract.IssueDeletionCodeResponse;
  ConfirmAge(ctx: Ctx, request: CoreContract.ConfirmAgeRequest): CoreContract.ConfirmAgeResponse | CoreErrorCode;
  UpdateConsent(ctx: Ctx, request: CoreContract.UpdateConsentRequest): CoreContract.UpdateConsentResponse | CoreErrorCode;
  UpdatePushConsent(ctx: Ctx, request: CoreContract.UpdatePushConsentRequest): CoreContract.UpdatePushConsentResponse | CoreErrorCode;

  verify_access_token(token: string): { readonly user_id: bigint; readonly session_id: string } | CoreErrorCode;
  prepare_link_account(user_id: bigint, request: CoreContract.LinkAccountRequest, client_ip: string): Promise<SocialAccount | CoreErrorCode>;
  'GET /account/deletion'(request: RouteRequest, client_ip: string): RouteResponse;
  'POST /account/deletion'(request: RouteRequest, client_ip: string): Promise<RouteResponse>;

  /** The admin operations auth exports, by name. */
  readonly withdraw_user: AdminOperation;
  readonly find_user_by_social_account: AdminOperation;
  readonly find_user_by_public_code: AdminOperation;

  /** For the DEV code, before server start. */
  use_dev(slot: AuthDevSlot): void;
  /** For the DEV code: the state its operations share with the module. */
  readonly state: AuthState;
}

function adapter_name_error(key: SocialAdapterKey, name: string): string {
  return `auth: environments.<ENV>.adapters.${key} is ${name}, not fake or ${key}`;
}

/** The social adapters of this environment, or the server start failure reasons. */
function make_adapters(a: AuthState, dev: AuthDevSlot | null): string[] {
  const { settings: s, server } = a;
  const errors: string[] = [];
  const now = (): bigint => a.modules['server-time'].clock_now();
  const fake = (key: SocialAdapterKey): (AppleAdapter & GoogleAdapter) | null => {
    const given = server.fake_adapter(key) as (AppleAdapter & GoogleAdapter) | null;
    const made = given ?? dev?.fake_adapter(key) ?? null;
    if (made === null) errors.push(`auth: adapter ${key} is fake but this server instance has no DEV code`);
    return made;
  };
  const source = (key: SocialAdapterKey, url: string) => server.key_source(key) ?? url_key_source(server.http, url, s.external_max_response_bytes);
  const secret = (key: string): string => {
    const value = server.read_secret(key);
    if (value === null) errors.push(`auth: secret ${key} could not be read`);
    return value ?? '';
  };
  if (s.adapter_apple === 'fake') a.apple = fake('login-apple');
  else if (s.adapter_apple === 'login-apple') {
    const pem = secret('loginApple');
    a.apple = create_login_apple(
      { app_id: s.app_id, team_id: s.apple_team_id, key_id: s.apple_key_id, private_key_pem: pem, jwks_cache_ms: s.jwks_cache_ms, max_response_bytes: s.external_max_response_bytes },
      server.http,
      source('login-apple', APPLE_JWKS_URL),
      now,
    );
    if (a.apple === null && pem !== '') errors.push('auth: secret loginApple is not an EC private key PEM');
  } else if (s.adapter_apple !== null) errors.push(adapter_name_error('login-apple', s.adapter_apple));
  if (s.adapter_google === 'fake') a.google = fake('login-google');
  else if (s.adapter_google === 'login-google') {
    const desktop_secret = s.google_desktop_client_id === '' ? '' : secret('loginGoogleDesktop');
    a.google = create_login_google(
      {
        server_client_id: s.google_server_client_id,
        ios_client_id: s.google_ios_client_id,
        desktop_client_id: s.google_desktop_client_id,
        desktop_client_secret: desktop_secret,
        jwks_cache_ms: s.jwks_cache_ms,
        max_response_bytes: s.external_max_response_bytes,
      },
      server.http,
      source('login-google', GOOGLE_JWKS_URL),
      now,
    );
  } else if (s.adapter_google !== null) errors.push(adapter_name_error('login-google', s.adapter_google));
  return errors;
}

/** Makes `auth` for one server instance. A setting of the wrong type throws. */
export function create_auth(input: AuthInput): Auth {
  const a: AuthState = { settings: read_settings(input.settings), modules: input.modules, server: auth_server(input), token_key: null, apple: null, google: null };
  const texts = new PageText(a);
  let dev: AuthDevSlot | null = null;
  const operations = admin_operations(a);
  return {
    begin_start() {
      const { storage, iap } = a.modules;
      for (const table of [...TABLES, ...(dev?.tables ?? [])]) register(storage, table);
      iap?.register_account_lookup((db, user_id) => has_social_link(db, user_id));
      const delete_after = a.settings.inactive_guest_delete_after_ms;
      if (delete_after !== null) {
        const job = guest_sweep_job(a, delete_after);
        a.modules['server-time'].schedule_job('auth_guest_sweep', a.settings.guest_sweep_interval_ms, async () => {
          try {
            await job();
          } catch (error) {
            error_log(a, 'job auth_guest_sweep failed', { request: 'auth_guest_sweep' }, { stack_trace: error instanceof Error ? (error.stack ?? error.message) : String(error) });
          }
        });
      }
    },
    complete_start() {
      const errors = settings_errors(a.settings, a.server.env);
      const seed = a.server.read_secret('accessTokenKey');
      if (seed === null) errors.push('auth: secret accessTokenKey could not be read');
      else {
        a.token_key = access_token_key(seed);
        if (a.token_key === null) errors.push('auth: secret accessTokenKey is not an Ed25519 seed of 32 bytes in standard base64');
      }
      errors.push(...make_adapters(a, dev));
      // routing logs the reason of a server start failure.
      return errors.length === 0 ? null : errors.join('; ');
    },
    stop() {},

    Login: (input) => login(a, tokenless_input(input)),
    AutoLogin: (input) => auto_login(a, tokenless_input(input)),
    RefreshToken: (input) => refresh_token(a, tokenless_input(input)),
    GetTerms: () => Promise.resolve(get_terms(a)),

    Logout: (ctx) => logout(a, ctx),
    LinkAccount: (ctx, _request, prepare) => link_account(a, ctx, prepare),
    Withdraw: (ctx) => withdraw_request(a, ctx),
    IssueDeletionCode: (ctx) => issue_deletion_code(a, ctx),
    ConfirmAge: (ctx, request) => confirm_age(a, ctx, request),
    UpdateConsent: (ctx, request) => update_consent(a, ctx, request),
    UpdatePushConsent: (ctx, request) => update_push_consent(a, ctx, request),

    verify_access_token: (token) => verify_access_token(a, token),
    prepare_link_account: (user_id, request, client_ip) => prepare_link_account(a, user_id, request, client_ip),
    'GET /account/deletion': (request) => deletion_page(a, texts, request),
    'POST /account/deletion': (request, client_ip) => deletion_post(a, texts, request, client_ip),

    withdraw_user: operations.withdraw_user,
    find_user_by_social_account: operations.find_user_by_social_account,
    find_user_by_public_code: operations.find_user_by_public_code,

    use_dev(slot) {
      dev = slot;
    },
    state: a,
  };
}
