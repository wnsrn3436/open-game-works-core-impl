import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';

/** The operators of a test server: `ogw` with every role and one operator per role named after it (`### isolation`). */
export const OPERATORS = ['ogw', 'read', 'ops', 'economy', 'release'] as const;

type SecretForm = 'p256_pem' | 'rsa_pem' | 'text';

/**
 * The `environments.<ENV>.secrets` keys a real or sandbox adapter reads and the form of their values, from the
 * `## settings` of the module spec that defines the adapter.
 */
const ADAPTER_SECRETS: Readonly<Record<string, readonly (readonly [string, SecretForm])[]>> = {
  'login-apple': [['loginApple', 'p256_pem']],
  'login-google': [['loginGoogleDesktop', 'text']],
  'iap-apple': [['iapApple', 'p256_pem']],
  'iap-apple-sandbox': [['iapApple', 'p256_pem']],
  'iap-google': [['iapGoogle', 'rsa_pem']],
  'ads-admob': [],
  'push-fcm': [['pushFcm', 'rsa_pem']],
  'push-apns': [['pushApns', 'p256_pem']],
  'push-apns-sandbox': [['pushApns', 'p256_pem']],
  'turn-coturn': [['turn', 'text']],
  'cdn-r2': [['cdn', 'text']],
  'analytics-ga4': [['analytics', 'text'], ['analyticsServiceAccount', 'rsa_pem']],
};

/** True when `name` is a real or sandbox adapter name a test server can take. */
export function is_real_adapter(name: string): boolean {
  return name in ADAPTER_SECRETS;
}

function random_text(): string {
  return randomBytes(32).toString('base64url');
}

/** The DER PKCS#8 prefix of an Ed25519 private key: the 32 byte seed follows it. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** An Ed25519 key as the secrets hold it: the private key seed in standard base64, and the public key in standard base64. */
function ed25519_key(): { seed: string; public_key: string } {
  const seed = randomBytes(32);
  const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
  return { seed: seed.toString('base64'), public_key: spki.subarray(spki.length - 32).toString('base64') };
}

function secret_value(form: SecretForm): string {
  if (form === 'text') return random_text();
  const pair = form === 'p256_pem'
    ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    : generateKeyPairSync('rsa', { modulusLength: 2048 });
  return pair.privateKey.export({ format: 'pem', type: 'pkcs8' });
}

/** The secret values of one test server: what the `--secret-file` file holds, and the values the test helper uses. */
export interface TestSecrets {
  /** The `--secret-file` JSON object. */
  readonly file: Readonly<Record<string, string>>;
  readonly dev_access: string;
  /** The Ed25519 public key of `updateSigningKey`, in standard base64. */
  readonly update_public_key: string;
}

/**
 * New secret values for a test server (`server-core` `## server start` `--secret-file`): `accessTokenKey`,
 * `updateSigningKey`, `iapAccountToken`, `devAccess`, `db` for PostgreSQL, the admin secret of each operator, and
 * new test values of the secrets of each real adapter.
 */
export function new_secrets(db: string | null, real_adapters: readonly string[]): TestSecrets {
  const update = ed25519_key();
  const dev_access = random_text();
  const file: Record<string, string> = {
    accessTokenKey: ed25519_key().seed,
    updateSigningKey: update.seed,
    iapAccountToken: random_text(),
    devAccess: dev_access,
  };
  if (db !== null) file.db = db;
  for (const operator of OPERATORS) file[`adminSecret.${operator}`] = random_text();
  for (const adapter of real_adapters) {
    for (const [key, form] of ADAPTER_SECRETS[adapter] ?? []) {
      if (!(key in file)) file[key] = secret_value(form);
    }
  }
  return { file, dev_access, update_public_key: update.public_key };
}
