/**
 * Translation binaries of the server build data (`data` tool.md): `translation_<code>.bin`, read with the generated
 * `GameData.load_translation`.
 */
import * as GameData from '../../generated/data/game_data.ts';

/** The file name of a language's translation binary: the language `code` in lower case. */
export function translation_file(language: string): string {
  return `translation_${language.toLowerCase()}.bin`;
}

/** Translation binaries of one server instance, read once per language. */
export class Translations {
  readonly #read: (name: string) => Uint8Array | null;
  readonly #cache = new Map<string, ReadonlyMap<string, string> | null>();

  constructor(read: (name: string) => Uint8Array | null) {
    this.#read = read;
  }

  /** The texts of a language, or null when its translation binary is missing or does not decode. */
  of(language: string): ReadonlyMap<string, string> | null {
    if (!this.#cache.has(language)) {
      const bytes = this.#read(translation_file(language));
      this.#cache.set(language, bytes === null ? null : GameData.load_translation(bytes));
    }
    return this.#cache.get(language) ?? null;
  }

  /** The text of a translation key in a language, or null when there is none. */
  text(language: string, key: string): string | null {
    return this.of(language)?.get(key) ?? null;
  }
}
