/** The values of iap `## settings` from the module input `settings`. */

export interface TestGrantLimit {
  readonly count: number;
  readonly period_ms: number;
}

export interface IapSettings {
  readonly max_receipt_bytes: number;
  readonly max_transaction_id_length: number;
  readonly verify_timeout_ms: number;
  readonly notify_max_body_bytes: number;
  readonly notify_body_read_timeout_ms: number;
  readonly subscription_sync_interval_ms: number;
  readonly withdrawn_record_retention_ms: number;
  readonly fake_subscription_period_ms: number;
  /** Secret names by secret key: `iapAccountToken`, `iapApple`, `iapGoogle`. Empty when game settings name none. */
  readonly secret_names: Readonly<Record<'iapAccountToken' | 'iapApple' | 'iapGoogle', string>>;
  readonly apple_issuer_id: string;
  readonly apple_key_id: string;
  readonly app_apple_id: number;
  readonly google_service_account_email: string;
  readonly google_notification_service_account_email: string;
  readonly server_url: string;
  readonly age_confirmation: boolean;
  /** Monthly spend limit by age n (decimal string key). */
  readonly monthly_below_age: Readonly<Record<string, unknown>>;
  readonly test_grants: TestGrantLimit | null;
  readonly age_band_boundaries: readonly unknown[];
  readonly app_id: string;
  readonly apple_adapter: string | null;
  readonly google_adapter: string | null;
  readonly external_max_response_bytes: number;
  readonly max_notify_id_bytes: number;
}

function integer(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`iap: setting ${key} is not an integer`);
  return value;
}

function text(settings: Readonly<Record<string, unknown>>, key: string): string {
  const value = settings[key];
  return typeof value === 'string' ? value : '';
}

function nullable_text(settings: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = settings[key];
  return typeof value === 'string' ? value : null;
}

function test_grants(value: unknown): TestGrantLimit | null {
  if (value === null || value === undefined) return null;
  const limit = value as { count?: unknown; periodMs?: unknown };
  if (typeof limit.count !== 'number' || !Number.isSafeInteger(limit.count) || typeof limit.periodMs !== 'number' || !Number.isSafeInteger(limit.periodMs)) {
    throw new TypeError('iap: game settings purchaseLimits.testGrants is not {count, periodMs}');
  }
  return { count: limit.count, period_ms: limit.periodMs };
}

/** Reads the settings; a core settings key that is not an integer throws. */
export function read_settings(settings: Readonly<Record<string, unknown>>): IapSettings {
  const monthly = settings['purchaseLimits.monthlyBelowAge'];
  const boundaries = settings['consent.ageBandBoundaries'];
  return {
    max_receipt_bytes: integer(settings, 'iap.maxReceiptBytes'),
    max_transaction_id_length: integer(settings, 'iap.maxTransactionIdLength'),
    verify_timeout_ms: integer(settings, 'iap.verifyTimeoutMs'),
    notify_max_body_bytes: integer(settings, 'iap.notifyMaxBodyBytes'),
    notify_body_read_timeout_ms: integer(settings, 'iap.notifyBodyReadTimeoutMs'),
    subscription_sync_interval_ms: integer(settings, 'iap.subscriptionSyncIntervalMs'),
    withdrawn_record_retention_ms: integer(settings, 'iap.withdrawnRecordRetentionMs'),
    fake_subscription_period_ms: integer(settings, 'iap.fakeSubscriptionPeriodMs'),
    secret_names: {
      iapAccountToken: text(settings, 'environments.<ENV>.secrets.iapAccountToken'),
      iapApple: text(settings, 'environments.<ENV>.secrets.iapApple'),
      iapGoogle: text(settings, 'environments.<ENV>.secrets.iapGoogle'),
    },
    apple_issuer_id: text(settings, 'iapApple.issuerId'),
    apple_key_id: text(settings, 'iapApple.keyId'),
    app_apple_id: typeof settings['iapApple.appAppleId'] === 'number' ? settings['iapApple.appAppleId'] : 0,
    google_service_account_email: text(settings, 'iapGoogle.serviceAccountEmail'),
    google_notification_service_account_email: text(settings, 'iapGoogle.notificationServiceAccountEmail'),
    server_url: text(settings, 'environments.<ENV>.serverUrl'),
    age_confirmation: settings['consent.ageConfirmation'] === true,
    monthly_below_age: typeof monthly === 'object' && monthly !== null && !Array.isArray(monthly) ? (monthly as Record<string, unknown>) : {},
    test_grants: test_grants(settings['purchaseLimits.testGrants']),
    age_band_boundaries: Array.isArray(boundaries) ? boundaries : [],
    app_id: text(settings, 'appId'),
    apple_adapter: nullable_text(settings, 'environments.<ENV>.adapters.iap-apple'),
    google_adapter: nullable_text(settings, 'environments.<ENV>.adapters.iap-google'),
    external_max_response_bytes: integer(settings, 'routing.externalMaxResponseBytes'),
    max_notify_id_bytes: integer(settings, 'idempotency.maxNotifyIdBytes'),
  };
}

/** The reason server start fails for `purchaseLimits.monthlyBelowAge` (`## settings`), or null. */
export function monthly_limit_problem(settings: IapSettings): string | null {
  const boundaries = new Set(settings.age_band_boundaries.map((b) => String(b)));
  for (const [key, value] of Object.entries(settings.monthly_below_age)) {
    if (!boundaries.has(key)) return `game settings purchaseLimits.monthlyBelowAge key ${key} is not in consent.ageBandBoundaries`;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return `game settings purchaseLimits.monthlyBelowAge value of ${key} is not an integer above 0`;
  }
  return null;
}
