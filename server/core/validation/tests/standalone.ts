/**
 * A `validation` module object over a data set the test builds. The helpers these tests call (field validators, text,
 * integer, check helpers, registration) use no dependency module, so the module gets none.
 */
import * as GameData from '../../../generated/data/game_data.ts';
import { create_validation, type Validation, type ValidationInput } from '../index.ts';

/** A data set whose every table is empty. */
export function emptyData(): GameData.DataSet {
  const files = { get: () => new Uint8Array(0) } as unknown as ReadonlyMap<string, Uint8Array>;
  const data = GameData.load_data_set(files);
  if (data === null) throw new Error('an empty data set did not load');
  return data;
}

/** A copy of the data set with one container replaced. */
export function withContainer<K extends keyof GameData.DataSet>(data: GameData.DataSet, key: K, container: GameData.DataSet[K]): GameData.DataSet {
  return Object.assign(Object.create(Object.getPrototypeOf(data) as object) as GameData.DataSet, data, { [key]: container });
}

export function standalone(data: GameData.DataSet = emptyData()): Validation {
  return create_validation({ settings: { supportedLanguages: ['en'] }, modules: {} as ValidationInput['modules'], server: { data } });
}

export function bannedWordTable(rows: readonly [id: number, word: string, match: GameData.BannedWordMatch][]): GameData.BannedWordTable {
  return new GameData.BannedWordTable(rows.map(([id, word, match]) => Object.assign(new GameData.BannedWordRow(), { id, word, match })));
}

export function requirementTable(rows: readonly Partial<GameData.RequirementRow>[]): GameData.RequirementTable {
  return new GameData.RequirementTable(rows.map((row) => Object.assign(new GameData.RequirementRow(), row)));
}
