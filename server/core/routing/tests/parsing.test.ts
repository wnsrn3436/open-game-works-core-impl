import { PassThrough } from 'node:stream';
import { web_deletion_url } from '../../auth/index.ts';
import {
  check_data_version,
  client_ip,
  data_version_failure,
  is_allowed_origin,
  parse_common_headers,
  preflight_headers,
  read_body,
} from '../http.ts';

const P1 = 'a'.repeat(64);
const P2 = 'b'.repeat(64);
const D1 = 'c'.repeat(64);
const D2 = 'd'.repeat(64);
const V11 = `${P1}-${D1}`;
const V12 = `${P1}-${D2}`;
const V21 = `${P2}-${D1}`;

const GOOD_HEADERS = {
  'x-ogw-request-id': '0b8c2f4e-1d3a-4c5b-9e6f-7a8b9c0d1e2f',
  'authorization': 'Bearer token-1',
  'x-ogw-data-version': V11,
  'x-ogw-client-version': '1.2.3',
  'x-ogw-platform': 'android',
  'x-ogw-timestamp': '1000',
  'x-ogw-signature': 'ab',
};

describe('common header', () => {
  it('reads every common header of a well-formed request', () => {
    const headers = parse_common_headers('Echo', GOOD_HEADERS);
    expect(headers).toEqual({
      request_id: '0b8c2f4e-1d3a-4c5b-9e6f-7a8b9c0d1e2f',
      authorization: 'token-1',
      data_version: V11,
      client_version: '1.2.3',
      platform: 'android',
      timestamp: '1000',
      signature: 'ab',
    });
  });

  it('takes an empty client version (dev run)', () => {
    expect(parse_common_headers('Echo', { ...GOOD_HEADERS, 'x-ogw-client-version': '' })?.client_version).toBe('');
  });

  it.each([
    ['upper case request ID', { 'x-ogw-request-id': '0B8C2F4E-1D3A-4C5B-9E6F-7A8B9C0D1E2F' }],
    ['request ID not v4', { 'x-ogw-request-id': '0b8c2f4e-1d3a-1c5b-9e6f-7a8b9c0d1e2f' }],
    ['no request ID', { 'x-ogw-request-id': undefined }],
    ['data version without the data hash', { 'x-ogw-data-version': P1 }],
    ['data version with upper case hex', { 'x-ogw-data-version': V11.toUpperCase() }],
    ['client version with 2 parts', { 'x-ogw-client-version': '1.2' }],
    ['no client version header', { 'x-ogw-client-version': undefined }],
    ['unknown platform', { 'x-ogw-platform': 'ps5' }],
    ['no Authorization', { 'authorization': undefined }],
    ['Authorization without Bearer', { 'authorization': 'token-1' }],
  ])('rejects a request with %s', (_name, change) => {
    expect(parse_common_headers('Echo', { ...GOOD_HEADERS, ...change })).toBeNull();
  });

  it('does not want Authorization for Login, GetTerms, GetNotices and DevLogin', () => {
    for (const name of ['core/Login', 'core/GetTerms', 'core/GetNotices', 'core/cheat/DevLogin']) {
      expect(parse_common_headers(name, { ...GOOD_HEADERS, authorization: undefined })?.authorization).toBeNull();
    }
    expect(parse_common_headers('core/AutoLogin', { ...GOOD_HEADERS, authorization: undefined })).toBeNull();
    expect(parse_common_headers('core/RefreshToken', { ...GOOD_HEADERS, authorization: undefined })).toBeNull();
  });
});

describe('client IP', () => {
  it('is the value second from the right of X-Forwarded-For when 2 proxies are trusted', () => {
    expect(client_ip(2, '1.1.1.1, 2.2.2.2, 3.3.3.3', '10.0.0.1')).toBe('2.2.2.2');
  });

  it('is the TCP peer address when X-Forwarded-For has fewer values than the trusted proxies', () => {
    expect(client_ip(2, '3.3.3.3', '10.0.0.1')).toBe('10.0.0.1');
  });

  it('is the TCP peer address with no trusted proxy (LOCAL), whatever X-Forwarded-For says', () => {
    expect(client_ip(0, '1.1.1.1, 2.2.2.2', '::ffff:127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('web account deletion page address', () => {
  it('takes one trailing / off serverUrl, as auth does, and is 127.0.0.1 with the port on LOCAL', () => {
    expect(web_deletion_url('STG', 0, 'https://x.example//')).toBe('https://x.example//account/deletion');
    expect(web_deletion_url('PROD', 0, 'https://x.example/')).toBe('https://x.example/account/deletion');
    expect(web_deletion_url('DEV', 0, 'https://x.example')).toBe('https://x.example/account/deletion');
    expect(web_deletion_url('LOCAL', 8123, 'https://x.example')).toBe('http://127.0.0.1:8123/account/deletion');
  });
});

describe('CORS origin', () => {
  it('allows every localhost and 127.0.0.1 origin on LOCAL only', () => {
    expect(is_allowed_origin('http://localhost:5173', 'LOCAL', [])).toBe(true);
    expect(is_allowed_origin('https://127.0.0.1', 'LOCAL', [])).toBe(true);
    expect(is_allowed_origin('https://example.com', 'LOCAL', [])).toBe(false);
    expect(is_allowed_origin('http://localhost:5173', 'DEV', [])).toBe(false);
  });

  it('allows only an origin equal to an entry of the environment list', () => {
    expect(is_allowed_origin('https://game.example.com', 'PROD', ['https://game.example.com'])).toBe(true);
    expect(is_allowed_origin('https://game.example.com/', 'PROD', ['https://game.example.com'])).toBe(false);
    expect(is_allowed_origin('http://game.example.com', 'PROD', ['https://game.example.com'])).toBe(false);
  });

  it('answers a preflight with the common headers, POST and the max age in seconds; cheat paths add X-Ogw-Dev-Access', () => {
    const rpc = preflight_headers('http://localhost', 600999, false);
    expect(rpc['Access-Control-Allow-Origin']).toBe('http://localhost');
    expect(rpc['Access-Control-Allow-Methods']).toBe('POST');
    expect(rpc['Access-Control-Max-Age']).toBe('600');
    expect(rpc['Vary']).toBe('Origin');
    for (const name of ['X-Ogw-Request-Id', 'Authorization', 'X-Ogw-Data-Version', 'X-Ogw-Client-Version', 'X-Ogw-Platform', 'X-Ogw-Timestamp', 'X-Ogw-Signature', 'Content-Type']) {
      expect(rpc['Access-Control-Allow-Headers']).toContain(name);
    }
    expect(rpc['Access-Control-Allow-Headers']).not.toContain('X-Ogw-Dev-Access');
    expect(preflight_headers('http://localhost', 0, true)['Access-Control-Allow-Headers']).toContain('X-Ogw-Dev-Access');
    expect(rpc['Access-Control-Allow-Credentials']).toBeUndefined();
  });
});

describe('body limit', () => {
  it('cuts a body over the byte limit as the bytes arrive, whatever Content-Length says', async () => {
    const stream = new PassThrough();
    const result = read_body(stream, 10, new AbortController().signal);
    stream.write(Buffer.alloc(6));
    stream.write(Buffer.alloc(6));
    expect(await result).toBeNull();
  });

  it('reads a body up to the byte limit', async () => {
    const stream = new PassThrough();
    const result = read_body(stream, 10, new AbortController().signal);
    stream.end(Buffer.alloc(10, 7));
    expect(Array.from((await result) ?? [])).toEqual(new Array<number>(10).fill(7));
  });

  it('cuts a body read when the time limit signal aborts', async () => {
    const stream = new PassThrough();
    const abort = new AbortController();
    const result = read_body(stream, 100, abort.signal);
    stream.write(Buffer.alloc(3));
    abort.abort();
    expect(await result).toBeNull();
  });
});

describe('data version', () => {
  const never = (): boolean => false;
  const always = (): boolean => true;

  it('passes a request equal to client_data_version', () => {
    expect(check_data_version(V11, V11, null, false, '1.0.0', always)).toBe('pass');
  });

  it('is APP_UPDATE_REQUIRED when the protocol hash is neither client_data_version nor compat_client_data_version', () => {
    expect(check_data_version(V21, V11, null, false, '1.0.0', never)).toBe('APP_UPDATE_REQUIRED');
    expect(check_data_version(V21, V11, `${'e'.repeat(64)}-${D1}`, true, '1.0.0', never)).toBe('APP_UPDATE_REQUIRED');
  });

  it('passes a request equal to compat_client_data_version', () => {
    expect(check_data_version(V21, V11, V21, false, '1.0.0', always)).toBe('pass');
  });

  it('is DATA_UPDATE_REQUIRED for another data hash only when the update is ready or the client version is empty', () => {
    expect(check_data_version(V12, V11, null, false, '1.0.0', never)).toBe('pass');
    expect(check_data_version(V12, V11, null, false, '1.0.0', always)).toBe('DATA_UPDATE_REQUIRED');
    expect(check_data_version(V12, V11, null, false, '', never)).toBe('DATA_UPDATE_REQUIRED');
    expect(check_data_version(`${P2}-${D2}`, V11, V21, false, '1.0.0', always)).toBe('DATA_UPDATE_REQUIRED');
  });

  it('passes the play-keeping requests with only another data hash', () => {
    expect(check_data_version(V12, V11, null, true, '', always)).toBe('pass');
  });

  it('fails server start on a missing or wrong client_data_version, and on a compat_client_data_version with its protocol hash', () => {
    expect(data_version_failure(null, null)).not.toBeNull();
    expect(data_version_failure('x', null)).not.toBeNull();
    expect(data_version_failure(V11, null)).toBeNull();
    expect(data_version_failure(V11, V21)).toBeNull();
    expect(data_version_failure(V11, V12)).not.toBeNull();
    expect(data_version_failure(V11, 'x')).not.toBeNull();
  });
});
