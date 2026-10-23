/**
 * The `## settings` values auth reads, checked once at server start. A value of the wrong type throws (an input
 * format error); the rules of the spec (terms URL, age band boundaries) give a server start failure reason.
 */
import type { Environment } from './deps.ts';

export interface TermsEntry {
  readonly version: number;
  readonly url: string;
}

export interface AuthSettings {
  readonly access_token_ttl_ms: bigint;
  readonly max_token_bytes: number;
  readonly max_credential_bytes: number;
  readonly terms: { readonly TERMS: TermsEntry; readonly PRIVACY: TermsEntry };
  readonly social_verify_timeout_ms: bigint;
  readonly jwks_cache_ms: bigint;
  readonly app_id: string;
  readonly apple_team_id: string;
  readonly apple_key_id: string;
  readonly google_server_client_id: string;
  readonly google_ios_client_id: string;
  readonly google_desktop_client_id: string;
  readonly max_age_years: number;
  readonly child_age_years: number;
  readonly digital_consent_age_years: number;
  readonly age_band_boundaries: readonly number[];
  readonly minimum_age: number | null;
  readonly age_confirmation: boolean;
  readonly privacy_choices: boolean;
  readonly consent_version: number;
  readonly ad_push: boolean;
  readonly inactive_guest_delete_after_ms: bigint | null;
  readonly guest_sweep_interval_ms: bigint;
  readonly guest_sweep_batch_size: number;
  readonly max_dev_account_name_length: number;
  readonly adapter_apple: string | null;
  readonly adapter_google: string | null;
  readonly external_max_response_bytes: number;
  readonly deletion_code_length: number;
  readonly deletion_code_ttl_ms: bigint;
  readonly deletion_code_max_attempts: number;
  readonly deletion_attempts_per_minute: number;
  readonly server_url: string;
  readonly supported_languages: readonly string[];
  readonly source_language: string;
  readonly max_body_bytes: number;
  readonly body_read_timeout_ms: bigint;
}

type Settings = Readonly<Record<string, unknown>>;

function fail(key: string, what: string): never {
  throw new TypeError(`auth: setting ${key} is not ${what}`);
}

function integer(settings: Settings, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(key, 'an integer');
  return value;
}

function nullable_integer(settings: Settings, key: string): number | null {
  const value = settings[key];
  if (value === null || value === undefined) return null;
  return integer(settings, key);
}

function string(settings: Settings, key: string): string {
  const value = settings[key];
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail(key, 'a string');
  return value;
}

function nullable_string(settings: Settings, key: string): string | null {
  const value = settings[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') fail(key, 'a string');
  return value;
}

function boolean(settings: Settings, key: string): boolean {
  const value = settings[key];
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') fail(key, 'a boolean');
  return value;
}

function integers(settings: Settings, key: string): number[] {
  const value = settings[key];
  if (!Array.isArray(value) || !value.every((v): v is number => typeof v === 'number' && Number.isSafeInteger(v))) fail(key, 'an array of integers');
  return value;
}

function strings(settings: Settings, key: string): string[] {
  const value = settings[key];
  if (!Array.isArray(value) || !value.every((v): v is string => typeof v === 'string')) fail(key, 'an array of strings');
  return value;
}

function terms_entry(value: unknown, item: string): TermsEntry {
  if (typeof value !== 'object' || value === null) fail(`termsDocuments.${item}`, 'an object');
  const { version, url } = value as { version?: unknown; url?: unknown };
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) fail(`termsDocuments.${item}.version`, 'an integer');
  if (typeof url !== 'string') fail(`termsDocuments.${item}.url`, 'a string');
  return { version, url };
}

/** Reads the settings auth uses. Throws when a value has the wrong type. */
export function read_settings(settings: Settings): AuthSettings {
  const terms = settings.termsDocuments;
  if (typeof terms !== 'object' || terms === null) fail('termsDocuments', 'an object');
  const { TERMS, PRIVACY } = terms as { TERMS?: unknown; PRIVACY?: unknown };
  return {
    access_token_ttl_ms: BigInt(integer(settings, 'auth.accessTokenTtlMs')),
    max_token_bytes: integer(settings, 'auth.maxTokenBytes'),
    max_credential_bytes: integer(settings, 'auth.maxCredentialBytes'),
    terms: { TERMS: terms_entry(TERMS, 'TERMS'), PRIVACY: terms_entry(PRIVACY, 'PRIVACY') },
    social_verify_timeout_ms: BigInt(integer(settings, 'auth.socialVerifyTimeoutMs')),
    jwks_cache_ms: BigInt(integer(settings, 'auth.jwksCacheMs')),
    app_id: string(settings, 'appId'),
    apple_team_id: string(settings, 'appleTeamId'),
    apple_key_id: string(settings, 'loginApple.keyId'),
    google_server_client_id: string(settings, 'loginGoogle.serverClientId'),
    google_ios_client_id: string(settings, 'loginGoogle.iosClientId'),
    google_desktop_client_id: string(settings, 'loginGoogle.desktopClientId'),
    max_age_years: integer(settings, 'auth.maxAgeYears'),
    child_age_years: integer(settings, 'auth.childAgeYears'),
    digital_consent_age_years: integer(settings, 'auth.digitalConsentAgeYears'),
    age_band_boundaries: integers(settings, 'consent.ageBandBoundaries'),
    minimum_age: nullable_integer(settings, 'consent.minimumAge'),
    age_confirmation: boolean(settings, 'consent.ageConfirmation'),
    privacy_choices: boolean(settings, 'consent.privacyChoices'),
    consent_version: integer(settings, 'consent.version'),
    ad_push: boolean(settings, 'pushConsent.adPush'),
    inactive_guest_delete_after_ms: ((v) => (v === null ? null : BigInt(v)))(nullable_integer(settings, 'auth.inactiveGuestDeleteAfterMs')),
    guest_sweep_interval_ms: BigInt(integer(settings, 'auth.guestSweepIntervalMs')),
    guest_sweep_batch_size: integer(settings, 'auth.guestSweepBatchSize'),
    max_dev_account_name_length: integer(settings, 'auth.maxDevAccountNameLength'),
    adapter_apple: nullable_string(settings, 'environments.<ENV>.adapters.login-apple'),
    adapter_google: nullable_string(settings, 'environments.<ENV>.adapters.login-google'),
    external_max_response_bytes: integer(settings, 'routing.externalMaxResponseBytes'),
    deletion_code_length: integer(settings, 'auth.deletionCodeLength'),
    deletion_code_ttl_ms: BigInt(integer(settings, 'auth.deletionCodeTtlMs')),
    deletion_code_max_attempts: integer(settings, 'auth.deletionCodeMaxAttempts'),
    deletion_attempts_per_minute: integer(settings, 'auth.deletionAttemptsPerMinute'),
    server_url: string(settings, 'environments.<ENV>.serverUrl'),
    supported_languages: strings(settings, 'supportedLanguages'),
    source_language: string(settings, 'sourceLanguage'),
    max_body_bytes: integer(settings, 'routing.maxBodyBytes'),
    body_read_timeout_ms: BigInt(integer(settings, 'routing.bodyReadTimeoutMs')),
  };
}

/**
 * A terms document URL rule violation, or null: the scheme is `https` (LOCAL also takes `http`), there is a host,
 * and there is no user info.
 */
export function terms_url_error(url: string, env: Environment): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${url} is not a URL`;
  }
  const schemes = env === 'LOCAL' ? ['https:', 'http:'] : ['https:'];
  if (!schemes.includes(parsed.protocol)) return `${url} has scheme ${parsed.protocol.slice(0, -1)}`;
  if (parsed.hostname === '') return `${url} has no host`;
  if (parsed.username !== '' || parsed.password !== '') return `${url} has user info`;
  return null;
}

/**
 * An age band boundary rule violation, or null: integers in [1, `auth.maxAgeYears`] in ascending order without
 * duplicates that hold `auth.childAgeYears`, `auth.digitalConsentAgeYears` and `consent.minimumAge` (when not null).
 */
export function boundary_error(s: AuthSettings): string | null {
  const b = s.age_band_boundaries;
  for (let i = 0; i < b.length; i += 1) {
    const value = b[i] as number;
    if (value < 1 || value > s.max_age_years) return `consent.ageBandBoundaries value ${String(value)} is not in [1, auth.maxAgeYears]`;
    if (i > 0 && value <= (b[i - 1] as number)) return 'consent.ageBandBoundaries is not ascending without duplicates';
  }
  const required: [string, number | null][] = [
    ['auth.childAgeYears', s.child_age_years],
    ['auth.digitalConsentAgeYears', s.digital_consent_age_years],
    ['consent.minimumAge', s.minimum_age],
  ];
  for (const [key, value] of required) {
    if (value !== null && !b.includes(value)) return `consent.ageBandBoundaries does not hold ${key} ${String(value)}`;
  }
  return null;
}

/** The server start failure reasons of the settings, in the order the spec lists them. */
export function settings_errors(s: AuthSettings, env: Environment): string[] {
  const errors: string[] = [];
  for (const item of ['TERMS', 'PRIVACY'] as const) {
    const error = terms_url_error(s.terms[item].url, env);
    if (error !== null) errors.push(`auth: termsDocuments.${item}.url: ${error}`);
  }
  const boundary = boundary_error(s);
  if (boundary !== null) errors.push(`auth: ${boundary}`);
  return errors;
}
