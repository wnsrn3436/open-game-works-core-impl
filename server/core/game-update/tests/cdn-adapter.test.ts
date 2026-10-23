import { createHash } from 'node:crypto';
import { amz_date_of, create_cdn_r2_adapter, encode_segment, sigv4_authorization } from '../adapters/cdn_r2.ts';
import type { OutgoingHttp } from '../cdn.ts';
import { create_fake_adapter } from '../dev/adapters/fake.ts';
import { admin, client_data_version, new_file, publish_body, served, start, upload } from './helpers.ts';

const never = new AbortController().signal;

describe('AWS Signature Version 4', () => {
  it('signs the AWS documentation example "PUT Object"', () => {
    // AWS Signature Version 4 for Amazon S3, header based authentication, example "PUT Object".
    const authorization = sigv4_authorization({
      method: 'PUT',
      canonical_uri: `/${encode_segment('test$file.text')}`,
      headers: {
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        host: 'examplebucket.s3.amazonaws.com',
        'x-amz-content-sha256': '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
        'x-amz-date': '20130524T000000Z',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      payload_sha256: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
      amz_date: '20130524T000000Z',
      region: 'us-east-1',
      service: 's3',
      access_key_id: 'AKIAIOSFODNN7EXAMPLE',
      secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, ' +
        'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  it('writes x-amz-date from Unix ms', () => {
    expect(amz_date_of(1369353600000n)).toBe('20130524T000000Z');
  });
});

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

function adapter_with(answer: () => Promise<Response>, max_response_bytes = 1024): { adapter: ReturnType<typeof create_cdn_r2_adapter>; sent: Sent[] } {
  const sent: Sent[] = [];
  const http: OutgoingHttp = (url, init) => {
    sent.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body as Uint8Array });
    return answer();
  };
  const adapter = create_cdn_r2_adapter({
    settings: { accountId: 'acc', bucket: 'updates', accessKeyId: 'AKID', publicBaseUrl: 'https://cdn.example.com/u' },
    secret_access_key: 'secret',
    http,
    clock_now: () => 1700000000000n,
    cache_control: 'public, max-age=31536000, immutable',
    max_response_bytes,
  });
  return { adapter, sent };
}

describe('cdn-r2', () => {
  const bytes = Buffer.from('file bytes', 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  it('puts to the R2 S3 endpoint with the file response headers and a SigV4 authorization of region auto, service s3', async () => {
    const { adapter, sent } = adapter_with(() => Promise.resolve(new Response(null, { status: 200 })));
    expect(adapter.base_url()).toBe('https://cdn.example.com/u/');
    expect(await adapter.put(sha256, bytes, never)).toBe(true);
    const request = sent[0] as Sent;
    expect(request.url).toBe(`https://acc.r2.cloudflarestorage.com/updates/${sha256}`);
    expect(request.method).toBe('PUT');
    expect(request.headers['content-type']).toBe('application/octet-stream');
    expect(request.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(request.headers['x-amz-content-sha256']).toBe(sha256);
    expect(request.headers['x-amz-date']).toBe('20231114T221320Z');
    expect(request.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20231114\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(Buffer.from(request.body).equals(bytes)).toBe(true);
  });

  it('fails on a non-2xx answer, a communication failure and a response body over routing.externalMaxResponseBytes', async () => {
    expect(await adapter_with(() => Promise.resolve(new Response('denied', { status: 403 }))).adapter.put(sha256, bytes, never)).toBe(false);
    expect(await adapter_with(() => Promise.reject(new TypeError('fetch failed'))).adapter.put(sha256, bytes, never)).toBe(false);
    expect(await adapter_with(() => Promise.resolve(new Response('x'.repeat(2000), { status: 200 })), 1000).adapter.put(sha256, bytes, never)).toBe(false);
    expect(await adapter_with(() => Promise.resolve(new Response('x'.repeat(1000), { status: 200 })), 1000).adapter.put(sha256, bytes, never)).toBe(true);
  });
});

describe('cdn-r2 through server start', () => {
  it('takes accountId, bucket, accessKeyId and publicBaseUrl from environments.<ENV>.cdnR2 and the secret access key from secret cdn', async () => {
    const sent: Sent[] = [];
    const server = await start({
      settings: {
        'environments.<ENV>.adapters.cdn': 'cdn-r2',
        'environments.<ENV>.cdnR2': { accountId: 'acct-1', bucket: 'bucket-2', accessKeyId: 'AKID-3', publicBaseUrl: 'https://cdn.example.com/game' },
      },
      secrets: { updateSigningKey: Buffer.alloc(32, 9).toString('base64'), cdn: 'secret-4' },
      fetch: (url, init) => {
        sent.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body as Uint8Array });
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    });
    const files = [new_file('item.bin')];
    await upload(server, files);
    expect((await admin(server, 'publish_deploy_list', publish_body(client_data_version(), files))).status).toBe(200);
    expect(served(server)?.list.file_base_url).toBe('https://cdn.example.com/game/');
    expect(sent).toHaveLength(1);
    const request = sent[0] as Sent;
    const sha256 = files[0]?.sha256 ?? '';
    expect(request.url).toBe(`https://acct-1.r2.cloudflarestorage.com/bucket-2/${sha256}`);
    const { authorization, ...headers } = request.headers;
    expect(headers.host).toBe('acct-1.r2.cloudflarestorage.com');
    const signed = (secret_access_key: string): string =>
      sigv4_authorization({
        method: 'PUT',
        canonical_uri: `/bucket-2/${sha256}`,
        headers,
        payload_sha256: sha256,
        amz_date: headers['x-amz-date'] ?? '',
        region: 'auto',
        service: 's3',
        access_key_id: 'AKID-3',
        secret_access_key,
      });
    expect(authorization).toContain('Credential=AKID-3/');
    expect(authorization).toBe(signed('secret-4'));
    expect(authorization).not.toBe(signed('another secret'));
  });
});

describe('fake cdn adapter', () => {
  it('is no adapter until set_result base_url, puts true until set_result put, and records every call', async () => {
    const { adapter, controller } = create_fake_adapter('cdn');
    expect(adapter.base_url()).toBeNull();
    controller.set_result('base_url', 'https://fake-cdn.example.com/');
    expect(adapter.base_url()).toBe('https://fake-cdn.example.com/');
    const a = new Uint8Array(3);
    const b = new Uint8Array(4);
    expect(await adapter.put('a'.repeat(64), a, never)).toBe(true);
    controller.set_result('put', false);
    expect(await adapter.put('b'.repeat(64), b, never)).toBe(false);
    expect(await adapter.put('b'.repeat(64), b, never)).toBe(false);
    controller.set_result('put', true);
    expect(await adapter.put('a'.repeat(64), a, never)).toBe(true);
    expect(controller.calls()).toEqual([
      { operation: 'base_url', input: null },
      { operation: 'base_url', input: null },
      { operation: 'put', input: { sha256: 'a'.repeat(64), bytes: a } },
      { operation: 'put', input: { sha256: 'b'.repeat(64), bytes: b } },
      { operation: 'put', input: { sha256: 'b'.repeat(64), bytes: b } },
      { operation: 'put', input: { sha256: 'a'.repeat(64), bytes: a } },
    ]);
  });

  it('fails put on a failure condition over the result until it is cleared; timeout waits for the time limit signal', async () => {
    const { adapter, controller } = create_fake_adapter('cdn');
    controller.set_failure('put', 'communication_failure');
    expect(await adapter.put('a'.repeat(64), new Uint8Array(1), never)).toBe(false);
    controller.set_failure('put', 'timeout');
    const limit = new AbortController();
    const put = adapter.put('a'.repeat(64), new Uint8Array(1), limit.signal);
    limit.abort();
    expect(await put).toBe(false);
    controller.set_failure('put', null);
    expect(await adapter.put('a'.repeat(64), new Uint8Array(1), never)).toBe(true);
  });

  it('throws for another adapter key, an unknown operation, a base URL that is not absolute and a put result that is not a flag', () => {
    expect(() => create_fake_adapter('analytics')).toThrow();
    const { controller } = create_fake_adapter('cdn');
    expect(() => {
      controller.set_result('get', true);
    }).toThrow();
    expect(() => {
      controller.set_result('base_url', 'files/');
    }).toThrow();
    expect(() => {
      controller.set_result('put', 'ok');
    }).toThrow();
    expect(() => {
      controller.set_failure('base_url', 'timeout');
    }).toThrow();
  });
});
