/**
 * The real `cdn` adapter `cdn-r2` (Cloudflare R2): `put` is the S3 compatible `PUT
 * https://<accountId>.r2.cloudflarestorage.com/<bucket>/<sha256>` signed with AWS Signature Version 4 (region
 * `auto`, service `s3`). `base_url()` is `cdnR2.publicBaseUrl` with `/` appended.
 */
import { createHmac } from 'node:crypto';
import type { CdnAdapter, OutgoingHttp } from '../cdn.ts';
import { sha256_hex } from '../deploy_list.ts';

/** `environments.<ENV>.cdnR2` of game settings. */
export interface CdnR2Settings {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly publicBaseUrl: string;
}

export interface CdnR2Input {
  readonly settings: CdnR2Settings;
  /** The secret access key: the secret `environments.<ENV>.secrets.cdn`. */
  readonly secret_access_key: string;
  readonly http: OutgoingHttp;
  /** `server-time.clock_now`: the signing time. */
  readonly clock_now: () => bigint;
  /** The `Cache-Control` of `GET /update/files/<sha256>`. */
  readonly cache_control: string;
  /** `routing.externalMaxResponseBytes`. */
  readonly max_response_bytes: number;
}

/** One request to sign with AWS Signature Version 4. Header names are lowercase; `host` is among them. */
export interface SigV4Request {
  readonly method: string;
  /** The canonical URI: the path with each segment URI-encoded. */
  readonly canonical_uri: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Lowercase hex SHA-256 of the payload. */
  readonly payload_sha256: string;
  /** `YYYYMMDDTHHMMSSZ`. */
  readonly amz_date: string;
  readonly region: string;
  readonly service: string;
  readonly access_key_id: string;
  readonly secret_access_key: string;
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** The `Authorization` header value of a request (AWS Signature Version 4, header signing, no query string). */
export function sigv4_authorization(request: SigV4Request): string {
  const names = Object.keys(request.headers).sort();
  const canonical_headers = names.map((name) => `${name}:${(request.headers[name] ?? '').trim().replace(/ +/g, ' ')}\n`).join('');
  const signed_headers = names.join(';');
  const canonical_request = [request.method, request.canonical_uri, '', canonical_headers, signed_headers, request.payload_sha256].join('\n');
  const date = request.amz_date.slice(0, 8);
  const scope = `${date}/${request.region}/${request.service}/aws4_request`;
  const string_to_sign = ['AWS4-HMAC-SHA256', request.amz_date, scope, sha256_hex(canonical_request)].join('\n');
  const signing_key = hmac(hmac(hmac(hmac(`AWS4${request.secret_access_key}`, date), request.region), request.service), 'aws4_request');
  const signature = createHmac('sha256', signing_key).update(string_to_sign, 'utf8').digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${request.access_key_id}/${scope}, SignedHeaders=${signed_headers}, Signature=${signature}`;
}

/** `YYYYMMDDTHHMMSSZ` of a Unix ms time. */
export function amz_date_of(time_ms: bigint): string {
  return new Date(Number(time_ms)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** URI-encodes one path segment the SigV4 way: everything but unreserved characters. */
export function encode_segment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Reads a response body to its end; false when it passes `max_bytes` (reading stops there). */
async function drain(response: Response, max_bytes: number): Promise<boolean> {
  if (response.body === null) return true;
  let total = 0;
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > max_bytes) return false;
  }
  return true;
}

/** The `cdn-r2` adapter. */
export function create_cdn_r2_adapter(input: CdnR2Input): CdnAdapter {
  const { settings } = input;
  const host = `${settings.accountId}.r2.cloudflarestorage.com`;
  const base_url = `${settings.publicBaseUrl}/`;
  return {
    base_url: () => base_url,
    put: async (sha256, bytes, signal) => {
      const canonical_uri = `/${encode_segment(settings.bucket)}/${encode_segment(sha256)}`;
      const payload_sha256 = sha256_hex(bytes);
      const headers: Record<string, string> = {
        host,
        'content-type': 'application/octet-stream',
        'cache-control': input.cache_control,
        'x-amz-content-sha256': payload_sha256,
        'x-amz-date': amz_date_of(input.clock_now()),
      };
      const authorization = sigv4_authorization({
        method: 'PUT',
        canonical_uri,
        headers,
        payload_sha256,
        amz_date: headers['x-amz-date'] as string,
        region: 'auto',
        service: 's3',
        access_key_id: settings.accessKeyId,
        secret_access_key: input.secret_access_key,
      });
      try {
        const response = await input.http(`https://${host}${canonical_uri}`, { method: 'PUT', headers: { ...headers, authorization }, body: bytes, signal });
        const within = await drain(response, input.max_response_bytes);
        return within && response.status >= 200 && response.status < 300;
      } catch {
        return false;
      }
    },
  };
}
