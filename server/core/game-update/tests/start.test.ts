import { DB_KIND } from '../../storage/tests/helpers.ts';
import { admin, log_lines, public_key_of, start, start_failure, stranger_public_key, type StartFailure } from './helpers.ts';

const PUBLIC_KEYS = 'environments.<ENV>.updatePublicKeys';

/** `cdn` adapter `cdn-r2` with every `environments.<ENV>.cdnR2` field. */
const CDN_R2: Readonly<Record<string, unknown>> = {
  'environments.<ENV>.adapters.cdn': 'cdn-r2',
  'environments.<ENV>.cdnR2': { accountId: 'acct-1', bucket: 'bucket-2', accessKeyId: 'AKID-3', publicBaseUrl: 'https://cdn.example.com/game' },
};

/** The failure names `name`, and one `error` log line names it too. */
function expect_failure_naming(failure: StartFailure, name: string): void {
  expect(failure.reason).toContain(name);
  const errors = log_lines(failure.lines, 'error');
  expect(errors).toHaveLength(1);
  expect(String(errors[0]?.message)).toContain(name);
}

describe('signing key check at server start', () => {
  for (const environment of ['DEV', 'STG', 'PROD'] as const) {
    it(`does not start a ${environment} server whose signing key public key is not in updatePublicKeys, with an error log`, async () => {
      expect_failure_naming(await start_failure({ environment, settings: { [PUBLIC_KEYS]: [stranger_public_key()] } }), 'updatePublicKeys');
    });

    it(`starts a ${environment} server whose signing key public key is in updatePublicKeys, and gives that public key`, async () => {
      const seed = Buffer.alloc(32, 7).toString('base64');
      const server = await start({ environment, secrets: { updateSigningKey: seed }, settings: { [PUBLIC_KEYS]: [stranger_public_key(), public_key_of(seed)] } });
      const answer = await admin(server, 'get_update_signing_key');
      expect(answer.status).toBe(200);
      expect(answer.body.public_key).toBe(public_key_of(seed));
    });
  }

  it('does not check updatePublicKeys on LOCAL', async () => {
    const server = await start({ settings: { [PUBLIC_KEYS]: [stranger_public_key()] } });
    expect((await admin(server, 'get_update_signing_key')).status).toBe(200);
  });

  it('does not start when the signing key secret cannot be read or is not a 32 byte seed, with an error log', async () => {
    expect_failure_naming(await start_failure({ secrets: {} }), 'updateSigningKey');
    expect_failure_naming(await start_failure({ secrets: { updateSigningKey: Buffer.alloc(31).toString('base64') } }), 'updateSigningKey');
  });

  it('does not start when adapters.cdn is cdn-r2 and the cdn secret cannot be read, with an error log', async () => {
    expect_failure_naming(await start_failure({ settings: CDN_R2 }), 'the secret cdn');
  });
});

describe('secrets of a server start without --db', () => {
  const seed = Buffer.alloc(32, 5).toString('base64');
  const named = {
    ...CDN_R2,
    'environments.<ENV>.secrets.updateSigningKey': 'host-update-signing-key',
    'environments.<ENV>.secrets.cdn': 'host-cdn',
    [PUBLIC_KEYS]: [public_key_of(seed)],
  };

  it.runIf(DB_KIND === 'postgresql')('reads updateSigningKey and cdn from the host secrets that environments.<ENV>.secrets names', async () => {
    const server = await start({ environment: 'DEV', host_secrets: true, secrets: { 'host-update-signing-key': seed, 'host-cdn': 'secret-4' }, settings: named });
    expect((await admin(server, 'get_update_signing_key')).body.public_key).toBe(public_key_of(seed));
  });

  it.runIf(DB_KIND === 'postgresql')('does not start when the host secret that environments.<ENV>.secrets names is missing, with an error log', async () => {
    // Secrets under the keys themselves are not read without --db.
    const keyed = { updateSigningKey: seed, cdn: 'secret-4' };
    expect_failure_naming(await start_failure({ environment: 'DEV', host_secrets: true, secrets: { ...keyed, 'host-cdn': 'secret-4' }, settings: named }), 'updateSigningKey');
    expect_failure_naming(await start_failure({ environment: 'DEV', host_secrets: true, secrets: { ...keyed, 'host-update-signing-key': seed }, settings: named }), 'the secret cdn');
  });
});
