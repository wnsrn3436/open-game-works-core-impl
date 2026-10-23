/**
 * The `GetNotices` choice over the cached notices: the language, the period and target conditions, the order and the
 * limit (`### processing`). Pure: the module passes the cache, the request values, the settings and the `validation`
 * version helpers.
 */
import type { NoticeKind } from '../../generated/contract/core_contract.ts';
import type { Validation, Version } from '../validation/index.ts';

/** A notice text of one language (`put_notice` `texts`). */
export interface NoticeText {
  readonly language: string;
  readonly title: string;
  readonly body: string;
}

/** The `validation` version helpers the choice compares app versions with. */
export type NoticeVersions = Pick<Validation, 'parse_version' | 'compare_versions'>;

/** A stored notice as the cache holds it. */
export interface CachedNotice {
  readonly id: bigint;
  readonly kind: NoticeKind;
  readonly priority: number;
  readonly start_at: bigint;
  readonly end_at: bigint;
  readonly platforms: readonly string[];
  readonly languages: readonly string[];
  /** null: no limit. */
  readonly min_client_version: Version | null;
  /** null: no limit. */
  readonly max_client_version: Version | null;
  readonly texts: readonly NoticeText[];
  readonly image_url: string;
  readonly shortcut_id: number;
  readonly link_url: string;
}

/** A notice of the response: the `Notice` fields with the text of the chosen language. */
export interface ShownNotice {
  readonly id: bigint;
  readonly kind: NoticeKind;
  readonly priority: number;
  readonly start_at: bigint;
  readonly end_at: bigint;
  readonly title: string;
  readonly body: string;
  readonly image_url: string;
  readonly shortcut_id: number;
  readonly link_url: string;
}

/** What `GetNotices` judges by. */
export interface NoticeQuery {
  /** The requested BCP 47 tag. */
  readonly language: string;
  /** `X-Ogw-Platform`. */
  readonly platform: string;
  /** `X-Ogw-Client-Version`; the empty string for a dev run. */
  readonly client_version: string;
  /** `server-time.clock_now`. */
  readonly now: bigint;
}

/** The settings the choice reads. */
export interface NoticeChoiceSettings {
  readonly supported_languages: readonly string[];
  readonly source_language: string;
  readonly max_notices: number;
}

/** ASCII case-insensitive equality of two language tags. */
function same_tag(a: string, b: string): boolean {
  return ascii_lower(a) === ascii_lower(b);
}

function ascii_lower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/** The requested tag as `supportedLanguages` spells it when it is there, else `sourceLanguage`. */
export function choose_language(requested: string, settings: NoticeChoiceSettings): string {
  return settings.supported_languages.find((tag) => same_tag(tag, requested)) ?? settings.source_language;
}

/** The text of the chosen language; without one, the `sourceLanguage` text. */
function text_of(notice: CachedNotice, language: string, source_language: string): NoticeText | undefined {
  return notice.texts.find((t) => same_tag(t.language, language)) ?? notice.texts.find((t) => same_tag(t.language, source_language));
}

function version_passes(notice: CachedNotice, client_version: string, versions: NoticeVersions): boolean {
  if (client_version === '') return true;
  const version = versions.parse_version(client_version);
  if (version === null) return false;
  if (notice.min_client_version !== null && versions.compare_versions(version, notice.min_client_version) < 0) return false;
  if (notice.max_client_version !== null && versions.compare_versions(version, notice.max_client_version) > 0) return false;
  return true;
}

/** True when the notice is in its period and the client meets every target condition. */
function is_shown(notice: CachedNotice, query: NoticeQuery, language: string, versions: NoticeVersions): boolean {
  if (query.now < notice.start_at || query.now >= notice.end_at) return false;
  if (notice.platforms.length > 0 && !notice.platforms.includes(query.platform)) return false;
  if (notice.languages.length > 0 && !notice.languages.some((tag) => same_tag(tag, language))) return false;
  return version_passes(notice, query.client_version, versions);
}

/** `priority` descending, `start_at` descending, `id` ascending. */
function order(a: CachedNotice, b: CachedNotice): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.start_at !== b.start_at) return a.start_at > b.start_at ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** The notices `GetNotices` returns, in order, at most `notice.maxNotices`. */
export function choose_notices(
  notices: Iterable<CachedNotice>,
  query: NoticeQuery,
  settings: NoticeChoiceSettings,
  versions: NoticeVersions,
): ShownNotice[] {
  const language = choose_language(query.language, settings);
  const shown = [...notices].filter((n) => is_shown(n, query, language, versions)).sort(order);
  const result: ShownNotice[] = [];
  for (const notice of shown) {
    if (result.length >= settings.max_notices) break;
    const text = text_of(notice, language, settings.source_language);
    result.push({
      id: notice.id,
      kind: notice.kind,
      priority: notice.priority,
      start_at: notice.start_at,
      end_at: notice.end_at,
      title: text?.title ?? '',
      body: text?.body ?? '',
      image_url: notice.image_url,
      shortcut_id: notice.shortcut_id,
      link_url: notice.link_url,
    });
  }
  return result;
}
