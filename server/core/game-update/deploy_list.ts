/**
 * The deploy list (`game-update` `### deploy list`): the operator fields `app` and `patches`, their format check
 * (`publish_deploy_list` step 1), the server fields, and the serialization that is signed (key byte order, no
 * whitespace).
 */
import { createHash } from 'node:crypto';
import { canonical_json } from '../storage/index.ts';

export const DEPLOY_LIST_FORMAT = 1;

export const PLATFORMS: readonly string[] = ['android', 'ios', 'web', 'windows', 'macos', 'linux'];

export type Environment = 'LOCAL' | 'DEV' | 'STG' | 'PROD';

export interface AppEntry {
  readonly min_version: string;
  readonly recommended_version: string;
  readonly store_url: string;
}

export interface DataFile {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
}

export interface TranslationFile extends DataFile {
  readonly language: string;
}

export interface BundleFile extends DataFile {
  readonly bundle: string;
}

export interface PatchEntry {
  readonly data_version: string;
  readonly data_files: readonly DataFile[];
  readonly translation_files: readonly TranslationFile[];
  readonly bundle_files: readonly BundleFile[];
}

/** The operator fields of a deploy list. */
export interface DeployListInput {
  readonly app: Readonly<Record<string, AppEntry>>;
  readonly patches: Readonly<Record<string, PatchEntry>>;
}

/** The server fields of a deploy list. */
export interface ServerFields {
  readonly environment: Environment;
  readonly sequence: bigint;
  readonly published_at: bigint;
  readonly file_base_url: string;
}

const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const NAME = /^[a-z0-9_.-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** A format violation of step 1: the field path and the reason. */
export class FormatError extends Error {}

function fail(path: string, reason: string): never {
  throw new FormatError(`${path}: ${reason}`);
}

function is_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The object at `path` with exactly the fields `keys`. */
function exact_object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!is_object(value)) fail(path, 'not an object');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(path, `unknown field ${key}`);
  for (const key of keys) if (!(key in value)) fail(path, `missing field ${key}`);
  return value;
}

function string_at(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') fail(path, 'not a non-empty string');
  return value;
}

/** True when `text` is an app version `<major>.<minor>.<patch>`. */
export function is_app_version(text: string): boolean {
  return VERSION.test(text);
}

function version_at(value: unknown, path: string): string {
  const text = string_at(value, path);
  if (!is_app_version(text)) fail(path, 'not a version <major>.<minor>.<patch>');
  return text;
}

/** Compares two app versions by major, minor, patch. */
export function compare_versions(a: string, b: string): number {
  const pa = a.split('.').map(BigInt);
  const pb = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] ?? 0n;
    const y = pb[i] ?? 0n;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function https_url_at(value: unknown, path: string): string {
  const text = string_at(value, path);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    fail(path, 'not a URL');
  }
  if (url.protocol !== 'https:') fail(path, 'not an https URL');
  return text;
}

function app_entry(value: unknown, path: string): AppEntry {
  const entry = exact_object(value, ['min_version', 'recommended_version', 'store_url'], path);
  const min_version = version_at(entry.min_version, `${path}.min_version`);
  const recommended_version = version_at(entry.recommended_version, `${path}.recommended_version`);
  if (compare_versions(min_version, recommended_version) > 0) fail(path, 'min_version is above recommended_version');
  return { min_version, recommended_version, store_url: https_url_at(entry.store_url, `${path}.store_url`) };
}

function app_at(value: unknown): Record<string, AppEntry> {
  if (!is_object(value)) fail('app', 'not an object');
  const out: Record<string, AppEntry> = {};
  for (const [platform, entry] of Object.entries(value)) {
    if (!PLATFORMS.includes(platform)) fail('app', `unknown platform ${platform}`);
    out[platform] = app_entry(entry, `app.${platform}`);
  }
  return out;
}

function file_name_at(value: unknown, path: string): string {
  const name = string_at(value, path);
  if (!NAME.test(name)) fail(path, 'name is not [a-z0-9_.-]+');
  if (name.startsWith('.')) fail(path, 'name starts with .');
  if (name.endsWith('.tmp') || name.endsWith('.bak')) fail(path, 'name ends with .tmp or .bak');
  return name;
}

function size_at(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail(path, 'size is not an integer of 1 or more');
  return value;
}

function sha256_at(value: unknown, path: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(path, 'sha256 is not 64 lowercase hex');
  return value;
}

function data_file(value: unknown, path: string, extra: readonly string[]): Record<string, unknown> & DataFile {
  const file = exact_object(value, [...extra, 'name', 'size', 'sha256'], path);
  return { ...file, name: file_name_at(file.name, `${path}.name`), size: size_at(file.size, `${path}.size`), sha256: sha256_at(file.sha256, `${path}.sha256`) };
}

function list_at(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, 'not an array');
  return value;
}

function data_files_at(value: unknown, path: string): DataFile[] {
  return list_at(value, path).map((item, i) => {
    const file = data_file(item, `${path}[${String(i)}]`, []);
    return { name: file.name, size: file.size, sha256: file.sha256 };
  });
}

function translation_files_at(value: unknown, path: string): TranslationFile[] {
  const languages = new Set<string>();
  return list_at(value, path).map((item, i) => {
    const at = `${path}[${String(i)}]`;
    const file = data_file(item, at, ['language']);
    const language = string_at(file.language, `${at}.language`);
    if (languages.has(language)) fail(`${at}.language`, `language ${language} repeats`);
    languages.add(language);
    return { language, name: file.name, size: file.size, sha256: file.sha256 };
  });
}

function bundle_files_at(value: unknown, path: string): BundleFile[] {
  return list_at(value, path).map((item, i) => {
    const at = `${path}[${String(i)}]`;
    const file = data_file(item, at, ['bundle']);
    return { bundle: string_at(file.bundle, `${at}.bundle`), name: file.name, size: file.size, sha256: file.sha256 };
  });
}

function patch_entry(value: unknown, path: string): PatchEntry {
  const entry = exact_object(value, ['data_version', 'data_files', 'translation_files', 'bundle_files'], path);
  const patch: PatchEntry = {
    data_version: string_at(entry.data_version, `${path}.data_version`),
    data_files: data_files_at(entry.data_files, `${path}.data_files`),
    translation_files: translation_files_at(entry.translation_files, `${path}.translation_files`),
    bundle_files: bundle_files_at(entry.bundle_files, `${path}.bundle_files`),
  };
  const names = new Set<string>();
  for (const file of patch_files(patch)) {
    if (names.has(file.name)) fail(path, `name ${file.name} repeats`);
    names.add(file.name);
  }
  return patch;
}

function patches_at(value: unknown): Record<string, PatchEntry> {
  if (!is_object(value)) fail('patches', 'not an object');
  const out: Record<string, PatchEntry> = {};
  for (const [version, entry] of Object.entries(value)) {
    if (!is_app_version(version)) fail('patches', `key ${version} is not a version <major>.<minor>.<patch>`);
    out[version] = patch_entry(entry, `patches.${version}`);
  }
  return out;
}

/** Step 1 of `publish_deploy_list`: the input as a deploy list input, or a `FormatError`. */
export function parse_deploy_list_input(input: unknown): DeployListInput {
  const value = exact_object(input, ['app', 'patches'], 'input');
  return { app: app_at(value.app), patches: patches_at(value.patches) };
}

/** Every file entry of a patch entry: `data_files`, `translation_files`, `bundle_files` in that order. */
export function patch_files(patch: PatchEntry): DataFile[] {
  return [...patch.data_files, ...patch.translation_files, ...patch.bundle_files];
}

/** The files a deploy list input points to, once per `sha256` in first appearance order, with the size given first. */
export function referenced_files(input: DeployListInput): { sha256: string; size: number }[] {
  const out = new Map<string, number>();
  for (const patch of Object.values(input.patches)) {
    for (const file of patch_files(patch)) if (!out.has(file.sha256)) out.set(file.sha256, file.size);
  }
  return [...out].map(([sha256, size]) => ({ sha256, size }));
}

/** Every (sha256, size) pair the input points to, repeats included. Step 2 checks each against the stored file. */
export function file_size_claims(input: DeployListInput): { sha256: string; size: number }[] {
  return Object.values(input.patches).flatMap((patch) => patch_files(patch).map((file) => ({ sha256: file.sha256, size: file.size })));
}

/** Step 3: the app versions whose `data_version` is neither of the server's client data versions. */
export function unknown_data_versions(input: DeployListInput, client_data_version: string, compat_client_data_version: string | null): string[] {
  return Object.entries(input.patches)
    .filter(([, patch]) => patch.data_version !== client_data_version && patch.data_version !== compat_client_data_version)
    .map(([version]) => version);
}

/** The `sequence` of the next deploy list: max(previous + 1, `published_at`), or `published_at` with none stored. */
export function next_sequence(previous: bigint | null, published_at: bigint): bigint {
  if (previous === null) return published_at;
  return previous + 1n > published_at ? previous + 1n : published_at;
}

/** The deploy list bytes: the operator fields and the server fields, serialized for signing. BOM-less UTF-8. */
export function deploy_list_bytes(input: DeployListInput, server: ServerFields): Uint8Array {
  return Buffer.from(
    canonical_json({
      format: DEPLOY_LIST_FORMAT,
      environment: server.environment,
      sequence: server.sequence,
      published_at: server.published_at,
      file_base_url: server.file_base_url,
      app: input.app,
      patches: input.patches,
    }),
    'utf8',
  );
}

/** The patch entries of stored deploy list bytes: app version → `data_version` and its file `sha256`s. */
export function stored_patches(bytes: Uint8Array): Map<string, { data_version: string; sha256s: string[] }> {
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as { patches?: Record<string, PatchEntry> };
  const out = new Map<string, { data_version: string; sha256s: string[] }>();
  for (const [version, patch] of Object.entries(parsed.patches ?? {})) {
    out.set(version, { data_version: patch.data_version, sha256s: patch_files(patch).map((file) => file.sha256) });
  }
  return out;
}

/** The `Cache-Control` max-age seconds of a cache time: the ms divided by 1000, rounded down. */
export function max_age_seconds(ms: number): bigint {
  return BigInt(ms) / 1000n;
}

/** `Cache-Control` of `GET /update/deploy_list.json` and `GET /update/deploy_list.json.sig`. */
export function deploy_list_cache_control(deploy_list_max_age_ms: number): string {
  return `public, max-age=${String(max_age_seconds(deploy_list_max_age_ms))}`;
}

/** `Cache-Control` of `GET /update/files/<sha256>` (and of a CDN upload). */
export function file_cache_control(file_max_age_ms: number): string {
  return `public, max-age=${String(max_age_seconds(file_max_age_ms))}, immutable`;
}

/** True when `text` is a file `sha256`: 64 lowercase hex. */
export function is_sha256(text: string): boolean {
  return SHA256.test(text);
}

/** Lowercase hex SHA-256 of `data`. */
export function sha256_hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
