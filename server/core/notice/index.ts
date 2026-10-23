/**
 * notice: the in-game notices, banners and maintenance notices that operators register with admin operations, given
 * to clients by period and target conditions through `GetNotices`, before login and during maintenance too.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { AdminApi, AdminOperation, AdminTransaction, FieldSpec, HandlerFailure } from '../admin-api/index.ts';
import type { Logging } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { DbHandle, Storage } from '../storage/index.ts';
import { TextCheckResult, type Validation, type Version } from '../validation/index.ts';
import { choose_notices, type CachedNotice, type NoticeChoiceSettings, type NoticeText } from './select.ts';

/** The `admin-api` operation notice calls. */
export type NoticeAdminApi = Pick<AdminApi, 'is_maintenance'>;

/** The `validation` helpers notice calls. */
export type NoticeValidation = Pick<Validation, 'is_plain_text' | 'check_text' | 'has_table_id' | 'is_platform' | 'parse_version' | 'compare_versions'>;

/** The `logging` operation notice calls. */
export type NoticeLogging = Pick<Logging, 'write'>;

/** The `storage` operations notice calls. */
export type NoticeStorage = Pick<Storage, 'register_table' | 'db' | 'read_db' | 'lock_game_row' | 'after_commit'>;

/** The `server-time` operations notice calls. */
export type NoticeServerTime = Pick<ServerTimeApi, 'clock_now' | 'schedule_job'>;

/** The module input (`server-core` `## module`). notice reads nothing of `server`. */
export interface NoticeInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: unknown;
}

export interface NoticeModule {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** Core `rpc` `core/GetNotices`, a `NoUserRpc` handler. */
  GetNotices(request: CoreContract.GetNoticesRequest, platform: string, client_version: string): CoreContract.GetNoticesResponse;
  readonly put_notice: AdminOperation;
  readonly delete_notice: AdminOperation;
  readonly list_notices: AdminOperation;
}

type SettingKey = 'notice.maxNotices' | 'notice.maxStoredNotices' | 'notice.maxTitleChars' | 'notice.maxBodyChars' | 'notice.cacheMs';

const NOTICE_TABLE = 'notice_notice';
const SEQUENCE_TABLE = 'notice_sequence';
const SEQUENCE_ID = 0;

const KIND_ELEMENTS = ['Notice', 'Banner', 'Maintenance'] as const;
type KindElement = (typeof KIND_ELEMENTS)[number];
const KIND_VALUES: Readonly<Record<KindElement, CoreContract.NoticeKind>> = {
  Notice: CoreContract.NoticeKind.NOTICE_KIND_NOTICE,
  Banner: CoreContract.NoticeKind.NOTICE_KIND_BANNER,
  Maintenance: CoreContract.NoticeKind.NOTICE_KIND_MAINTENANCE,
};

const COLUMNS =
  'notice_id, kind, priority, start_at, end_at, platforms, languages, min_client_version, max_client_version, texts, image_url, shortcut_id, link_url, updated_at';
const SELECT_LIVE = `SELECT ${COLUMNS} FROM ${NOTICE_TABLE} WHERE end_at > $1 ORDER BY notice_id`;
const SELECT_LIVE_ONE = `SELECT notice_id FROM ${NOTICE_TABLE} WHERE notice_id = $1 AND end_at > $2`;
const COUNT_LIVE = `SELECT COUNT(*) AS live FROM ${NOTICE_TABLE} WHERE end_at > $1`;
const INSERT_NOTICE = `INSERT INTO ${NOTICE_TABLE} (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`;
const UPDATE_NOTICE =
  `UPDATE ${NOTICE_TABLE} SET kind = $2, priority = $3, start_at = $4, end_at = $5, platforms = $6, languages = $7, ` +
  'min_client_version = $8, max_client_version = $9, texts = $10, image_url = $11, shortcut_id = $12, link_url = $13, updated_at = $14 WHERE notice_id = $1';
const DELETE_NOTICE = `DELETE FROM ${NOTICE_TABLE} WHERE notice_id = $1`;
const SELECT_SEQUENCE = `SELECT last_notice_id FROM ${SEQUENCE_TABLE} WHERE id = $1`;
const INSERT_SEQUENCE = `INSERT INTO ${SEQUENCE_TABLE} (id, last_notice_id) VALUES ($1, $2)`;
const UPDATE_SEQUENCE = `UPDATE ${SEQUENCE_TABLE} SET last_notice_id = $2 WHERE id = $1`;

/** A notice as `put_notice` stores it, after the input checks. */
interface NoticeRecord {
  readonly notice_id: bigint;
  readonly kind: KindElement;
  readonly priority: number;
  readonly start_at: bigint;
  readonly end_at: bigint;
  readonly platforms: readonly string[];
  readonly languages: readonly string[];
  readonly min_client_version: string;
  readonly max_client_version: string;
  readonly texts: readonly NoticeText[];
  readonly image_url: string;
  readonly shortcut_id: number;
  readonly link_url: string;
  readonly updated_at: bigint;
}

const STRING: FieldSpec = { type: { kind: 'string' }, optional: false };
const INT64: FieldSpec = { type: { kind: 'int64' }, optional: false };
const INT32: FieldSpec = { type: { kind: 'int32' }, optional: false };
const STRINGS: FieldSpec = { type: { kind: 'array', element: { kind: 'string' } }, optional: false };

const PUT_INPUT: Readonly<Record<string, FieldSpec>> = {
  operation_id: STRING,
  notice_id: INT64,
  kind: { type: { kind: 'enum', elements: KIND_ELEMENTS }, optional: false },
  priority: INT32,
  start_at: INT64,
  end_at: INT64,
  platforms: STRINGS,
  languages: STRINGS,
  min_client_version: STRING,
  max_client_version: STRING,
  texts: {
    type: { kind: 'array', element: { kind: 'object', fields: { language: STRING, title: STRING, body: STRING } } },
    optional: false,
  },
  image_url: STRING,
  shortcut_id: INT32,
  link_url: STRING,
};

function integer_setting(settings: Readonly<Record<string, unknown>>, key: SettingKey): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`notice: setting ${key} is not an integer`);
  return value;
}

function string_list_setting(settings: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = settings[key];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new TypeError(`notice: setting ${key} is not a string list`);
  return [...value];
}

/** The origin `image_url` must have: `publicBaseUrl` of `environments.<ENV>.cdnR2`, or null when there is none. */
function image_origin_setting(settings: Readonly<Record<string, unknown>>): string | null {
  const cdn = settings['environments.<ENV>.cdnR2'];
  if (cdn === undefined || cdn === null) return null;
  if (typeof cdn !== 'object' || Array.isArray(cdn)) throw new TypeError('notice: setting environments.<ENV>.cdnR2 is not an object');
  const base = (cdn as Record<string, unknown>)['publicBaseUrl'];
  if (base === undefined || base === null || base === '') return null;
  if (typeof base !== 'string' || !URL.canParse(base)) throw new TypeError('notice: environments.<ENV>.cdnR2.publicBaseUrl is not a URL');
  return new URL(base).origin;
}

function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): unknown {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`notice: modules has no ${name}`);
  return module;
}

/** The empty string, or an `https` URL with a host and no user info. */
function is_allowed_url(text: string): boolean {
  if (text === '') return true;
  if (!/^https:\/\//i.test(text) || !URL.canParse(text)) return false;
  const url = new URL(text);
  return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
}

function to_bigint(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new TypeError(`notice: ${String(value)} is not an integer`);
}

function to_number(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new TypeError(`notice: ${String(value)} is not an integer`);
}

function parse_strings(text: unknown, column: string): string[] {
  const value: unknown = typeof text === 'string' ? JSON.parse(text) : null;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new TypeError(`notice: column ${column} is not a string list`);
  return value;
}

function parse_texts(text: unknown): NoticeText[] {
  const value: unknown = typeof text === 'string' ? JSON.parse(text) : null;
  const ok =
    Array.isArray(value) &&
    value.every((t: unknown) => {
      const row = t as Record<string, unknown> | null;
      return typeof row === 'object' && row !== null && typeof row['language'] === 'string' && typeof row['title'] === 'string' && typeof row['body'] === 'string';
    });
  if (!ok) throw new TypeError('notice: column texts is not a text list');
  return (value as Record<string, string>[]).map((t) => ({ language: t['language'] as string, title: t['title'] as string, body: t['body'] as string }));
}

function record_of(row: Readonly<Record<string, unknown>>): NoticeRecord {
  const kind = row['kind'];
  if (typeof kind !== 'string' || !(KIND_ELEMENTS as readonly string[]).includes(kind)) throw new TypeError(`notice: column kind ${String(kind)} is not a notice kind`);
  return {
    notice_id: to_bigint(row['notice_id']),
    kind: kind as KindElement,
    priority: to_number(row['priority']),
    start_at: to_bigint(row['start_at']),
    end_at: to_bigint(row['end_at']),
    platforms: parse_strings(row['platforms'], 'platforms'),
    languages: parse_strings(row['languages'], 'languages'),
    min_client_version: String(row['min_client_version']),
    max_client_version: String(row['max_client_version']),
    texts: parse_texts(row['texts']),
    image_url: String(row['image_url']),
    shortcut_id: to_number(row['shortcut_id']),
    link_url: String(row['link_url']),
    updated_at: to_bigint(row['updated_at']),
  };
}

/** The empty string (no limit) or a version `validation.parse_version` reads. */
function is_version_limit(validation: NoticeValidation, text: string): boolean {
  return text === '' || validation.parse_version(text) !== null;
}

/** A stored version limit: null for the empty string (no limit). */
function version_limit(validation: NoticeValidation, text: string): Version | null {
  return text === '' ? null : validation.parse_version(text);
}

function cached(validation: NoticeValidation, record: NoticeRecord): CachedNotice {
  return {
    id: record.notice_id,
    kind: KIND_VALUES[record.kind],
    priority: record.priority,
    start_at: record.start_at,
    end_at: record.end_at,
    platforms: record.platforms,
    languages: record.languages,
    min_client_version: version_limit(validation, record.min_client_version),
    max_client_version: version_limit(validation, record.max_client_version),
    texts: record.texts,
    image_url: record.image_url,
    shortcut_id: record.shortcut_id,
    link_url: record.link_url,
  };
}

/** The admin output form of a notice: the `put_notice` input fields with `updated_at`. */
function output_of(record: NoticeRecord): Record<string, unknown> {
  return {
    notice_id: record.notice_id,
    kind: record.kind,
    priority: record.priority,
    start_at: record.start_at,
    end_at: record.end_at,
    platforms: [...record.platforms],
    languages: [...record.languages],
    min_client_version: record.min_client_version,
    max_client_version: record.max_client_version,
    texts: record.texts.map((t) => ({ language: t.language, title: t.title, body: t.body })),
    image_url: record.image_url,
    shortcut_id: record.shortcut_id,
    link_url: record.link_url,
    updated_at: record.updated_at,
  };
}

function params_of(record: NoticeRecord): (bigint | number | string)[] {
  return [
    record.notice_id,
    record.kind,
    record.priority,
    record.start_at,
    record.end_at,
    JSON.stringify(record.platforms),
    JSON.stringify(record.languages),
    record.min_client_version,
    record.max_client_version,
    JSON.stringify(record.texts),
    record.image_url,
    record.shortcut_id,
    record.link_url,
    record.updated_at,
  ];
}

/** Makes `notice` for one server instance. A missing setting or dependency throws. */
export function create_notice(input: NoticeInput): NoticeModule {
  const admin_api = module_of(input.modules, 'admin-api', 'is_maintenance') as NoticeAdminApi;
  const validation = module_of(input.modules, 'validation', 'is_plain_text') as NoticeValidation;
  const storage = module_of(input.modules, 'storage', 'register_table') as NoticeStorage;
  const server_time = module_of(input.modules, 'server-time', 'clock_now') as NoticeServerTime;
  const logging = module_of(input.modules, 'logging', 'write') as NoticeLogging;
  const settings = input.settings;
  const supported_languages = string_list_setting(settings, 'supportedLanguages');
  const source_language = settings['sourceLanguage'];
  if (typeof source_language !== 'string') throw new TypeError('notice: setting sourceLanguage is not a string');
  const image_origin = image_origin_setting(settings);
  const choice: NoticeChoiceSettings = { supported_languages, source_language, max_notices: integer_setting(settings, 'notice.maxNotices') };
  const max_stored_notices = BigInt(integer_setting(settings, 'notice.maxStoredNotices'));
  const max_title_chars = integer_setting(settings, 'notice.maxTitleChars');
  const max_body_chars = integer_setting(settings, 'notice.maxBodyChars');
  const cache_ms = BigInt(integer_setting(settings, 'notice.cacheMs'));

  /** The notice cache of this server instance by notice ID. */
  let cache = new Map<bigint, CachedNotice>();

  const read_live = (db: DbHandle): NoticeRecord[] => db.query(SELECT_LIVE, [server_time.clock_now()]).map(record_of);

  const reload = (): void => {
    const next = new Map<bigint, CachedNotice>();
    for (const record of read_live(storage.read_db())) next.set(record.notice_id, cached(validation, record));
    cache = next;
  };

  const reload_logged = (): void => {
    try {
      reload();
    } catch (error) {
      logging.write({
        kind: 'error',
        level: 'error',
        message: `notice cache reload failed: ${error instanceof Error ? error.message : String(error)}`,
        user_id: null,
        request_id: null,
        request: null,
        fields: {},
      });
    }
  };

  /** One text per supported language, each title plain text and each body allowed by `check_text`. */
  const texts_allowed = (texts: readonly NoticeText[]): boolean => {
    const text_languages = texts.map((t) => t.language);
    if (texts.length !== supported_languages.length || !supported_languages.every((l) => text_languages.includes(l))) return false;
    return texts.every((text) => validation.is_plain_text(text.title, max_title_chars) && validation.check_text(text.body, max_body_chars, true).result !== TextCheckResult.INVALID);
  };

  /** Both URLs allowed, and a non-empty `image_url` on the image origin when there is one. */
  const urls_allowed = (image_url: string, link_url: string): boolean => {
    if (!is_allowed_url(image_url) || !is_allowed_url(link_url)) return false;
    return image_url === '' || image_origin === null || new URL(image_url).origin === image_origin;
  };

  /** The checked notice, or `bad_request` for an admin input rule violation. */
  const check_input = (value: Readonly<Record<string, unknown>>): Omit<NoticeRecord, 'notice_id' | 'updated_at'> | 'bad_request' => {
    const start_at = value['start_at'] as bigint;
    const end_at = value['end_at'] as bigint;
    if (start_at >= end_at) return 'bad_request';
    const platforms = value['platforms'] as string[];
    if (!platforms.every((p) => validation.is_platform(p))) return 'bad_request';
    const languages = value['languages'] as string[];
    if (!languages.every((l) => supported_languages.includes(l))) return 'bad_request';
    const min_client_version = value['min_client_version'] as string;
    const max_client_version = value['max_client_version'] as string;
    if (!is_version_limit(validation, min_client_version) || !is_version_limit(validation, max_client_version)) return 'bad_request';
    const texts = (value['texts'] as Record<string, string>[]).map((t) => ({ language: t['language'] as string, title: t['title'] as string, body: t['body'] as string }));
    if (!texts_allowed(texts)) return 'bad_request';
    const image_url = value['image_url'] as string;
    const link_url = value['link_url'] as string;
    if (!urls_allowed(image_url, link_url)) return 'bad_request';
    const shortcut_id = value['shortcut_id'] as number;
    if (shortcut_id !== 0 && !validation.has_table_id('shortcut', shortcut_id)) return 'bad_request';
    return {
      kind: value['kind'] as KindElement,
      priority: value['priority'] as number,
      start_at,
      end_at,
      platforms,
      languages,
      min_client_version,
      max_client_version,
      texts,
      image_url,
      shortcut_id,
      link_url,
    };
  };

  /** A new notice ID from `notice_sequence`, or `bad_request` when `notice.maxStoredNotices` notices remain. */
  const next_notice_id = (tx: AdminTransaction, db: DbHandle, now: bigint): bigint | HandlerFailure => {
    if (storage.lock_game_row(tx, SEQUENCE_TABLE, [SEQUENCE_ID]) === 'FAILED') return 'internal';
    const row = db.query(SELECT_SEQUENCE, [SEQUENCE_ID])[0];
    let last = 0n;
    if (row === undefined) db.query(INSERT_SEQUENCE, [SEQUENCE_ID, 0n]);
    else last = to_bigint(row['last_notice_id']);
    const live = db.query(COUNT_LIVE, [now])[0]?.['live'] ?? 0;
    if (to_bigint(live) >= max_stored_notices) return 'bad_request';
    const notice_id = last + 1n;
    db.query(UPDATE_SEQUENCE, [SEQUENCE_ID, notice_id]);
    return notice_id;
  };

  const put_notice: AdminOperation = {
    name: 'put_notice',
    role: 'ops',
    body: 'json',
    max_body_bytes: null,
    input: PUT_INPUT,
    user_target: null,
    prepare: null,
    audit_args: null,
    handler(value, tx) {
      const checked = check_input(value);
      if (checked === 'bad_request') return checked;
      const requested_id = value['notice_id'] as bigint;
      const db = storage.db(tx);
      const now = server_time.clock_now();
      let notice_id: bigint;
      if (requested_id === 0n) {
        const next = next_notice_id(tx, db, now);
        if (typeof next === 'string') return next;
        notice_id = next;
      } else {
        if (storage.lock_game_row(tx, NOTICE_TABLE, [requested_id]) === 'FAILED') return 'internal';
        if (db.query(SELECT_LIVE_ONE, [requested_id, now]).length === 0) return 'not_found';
        notice_id = requested_id;
      }
      const record: NoticeRecord = { ...checked, notice_id, updated_at: now };
      db.query(requested_id === 0n ? INSERT_NOTICE : UPDATE_NOTICE, params_of(record));
      storage.after_commit(tx, () => {
        const next = new Map(cache);
        next.set(notice_id, cached(validation, record));
        cache = next;
      });
      return { notice_id };
    },
  };

  const delete_notice: AdminOperation = {
    name: 'delete_notice',
    role: 'ops',
    body: 'json',
    max_body_bytes: null,
    input: { notice_id: INT64 },
    user_target: null,
    prepare: null,
    audit_args: null,
    handler(value, tx) {
      const notice_id = value['notice_id'] as bigint;
      const db = storage.db(tx);
      if (storage.lock_game_row(tx, NOTICE_TABLE, [notice_id]) === 'FAILED') return 'internal';
      if (db.query(SELECT_LIVE_ONE, [notice_id, server_time.clock_now()]).length === 0) return 'not_found';
      db.query(DELETE_NOTICE, [notice_id]);
      storage.after_commit(tx, () => {
        const next = new Map(cache);
        next.delete(notice_id);
        cache = next;
      });
      return {};
    },
  };

  const list_notices: AdminOperation = {
    name: 'list_notices',
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: {},
    user_target: null,
    prepare: null,
    audit_args: null,
    handler(_value, tx) {
      return { notices: read_live(storage.db(tx)).map(output_of) };
    },
  };

  return {
    begin_start() {
      storage.register_table(
        NOTICE_TABLE,
        'game',
        [
          { name: 'notice_id', type: 'int64' },
          { name: 'kind', type: 'string' },
          { name: 'priority', type: 'int32' },
          { name: 'start_at', type: 'int64' },
          { name: 'end_at', type: 'int64' },
          { name: 'platforms', type: 'string' },
          { name: 'languages', type: 'string' },
          { name: 'min_client_version', type: 'string' },
          { name: 'max_client_version', type: 'string' },
          { name: 'texts', type: 'string' },
          { name: 'image_url', type: 'string' },
          { name: 'shortcut_id', type: 'int32' },
          { name: 'link_url', type: 'string' },
          { name: 'updated_at', type: 'int64' },
        ],
        ['notice_id'],
        'end_at',
        null,
      );
      storage.register_table(
        SEQUENCE_TABLE,
        'game',
        [
          { name: 'id', type: 'int32' },
          { name: 'last_notice_id', type: 'int64' },
        ],
        ['id'],
        null,
        null,
      );
      server_time.schedule_job('notice_cache', cache_ms, reload_logged);
    },

    complete_start() {
      return null;
    },

    stop() {
      cache = new Map();
    },

    GetNotices(request, platform, client_version) {
      const response = new CoreContract.GetNoticesResponse();
      response.maintenance = admin_api.is_maintenance();
      const query = { language: request.language, platform, client_version, now: server_time.clock_now() };
      response.notices = choose_notices(cache.values(), query, choice, validation).map((shown) => {
        const notice = new CoreContract.Notice();
        notice.id = shown.id;
        notice.kind = shown.kind;
        notice.priority = shown.priority;
        notice.start_at = shown.start_at;
        notice.end_at = shown.end_at;
        notice.title = shown.title;
        notice.body = shown.body;
        notice.image_url = shown.image_url;
        notice.shortcut_id = shown.shortcut_id;
        notice.link_url = shown.link_url;
        return notice;
      });
      return response;
    },

    put_notice,
    delete_notice,
    list_notices,
  };
}
