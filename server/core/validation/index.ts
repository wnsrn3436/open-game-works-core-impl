/**
 * `validation`: runs the generated field validators, gives handlers check helpers, plain text and banned word checks,
 * integer helpers that match client `UtilCore`, and evaluates `requirement` rows with content judge hooks.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { RequestCtx, Storage } from '../storage/index.ts';
import { compareVersions, hasTableId, isInRange, isKindConsistent, isPlatform, isUnique, parseVersion, type KindFields, type Version } from './helper.ts';
import { apply_permille, big_apply_permille, big_floor_div, floor_div, floor_mod, type PermilleResult } from './integer.ts';
import { RequirementEvaluation, RequirementJudges, type RequirementJudge, type RequirementResult } from './requirement.ts';
import { bannedWords, checkText, emptyBannedWords, isPlainText, normalizeText, type TextCheck } from './text.ts';
import { Validators, type Message, type Pass } from './validator.ts';

export { PASS, type ModuleMessageName, type Message, type Pass } from './validator.ts';
export { TextCheckResult, type TextCheck } from './text.ts';
export type { KindFields, Version } from './helper.ts';
export type { PermilleResult } from './integer.ts';
export type { RequirementJudge, RequirementResult } from './requirement.ts';

/** The `server` input fields `validation` reads. */
export interface ValidationServer {
  /** The server build data of the server instance. */
  readonly data: GameData.DataSet;
}

/** The input of `create_validation` (`server-core` `## module`). */
export interface ValidationInput {
  /** `supportedLanguages`. Read only by the data tool that builds `banned_word`. */
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: {
    readonly storage: Pick<Storage, 'run_read_only'>;
    readonly 'item-ledger': object;
  };
  readonly server: ValidationServer;
}

/** The `validation` module object of one server instance. */
export interface Validation {
  validate_request(request_name: string, message: Message): Pass | CoreContract.ValidationFailure;
  validate_message(message_name: string, message: Message): Pass | CoreContract.ValidationFailure;
  is_in_range(value: number | bigint, min: number | bigint, max: number | bigint): boolean;
  has_table_id(table: string, id: number): boolean;
  is_unique<T>(list: readonly T[], key: (item: T) => number | bigint | string): boolean;
  is_plain_text(text: string, max_code_points: number): boolean;
  normalize_text(text: string): string;
  check_text(text: string, max_code_points: number, allow_newline: boolean): TextCheck;
  is_kind_consistent(message: object, kind_field: string, fields_by_kind: KindFields): boolean;
  floor_div(a: bigint, b: bigint): bigint;
  floor_mod(a: bigint, b: bigint): bigint;
  apply_permille(value: bigint, permille: bigint): PermilleResult;
  big_floor_div(a: bigint, b: bigint): bigint | null;
  big_apply_permille(value: bigint, permille: bigint): bigint;
  is_platform(text: string): boolean;
  parse_version(text: string): Version | null;
  compare_versions(a: Version, b: Version): number;
  register_requirement_judge(type: GameData.RequirementType, judge: RequirementJudge): void;
  evaluate_requirement(ctx: RequestCtx, requirement_id: number): RequirementResult;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

type Phase = 'created' | 'registering' | 'started';

export function create_validation(input: ValidationInput): Validation {
  const { data } = input.server;
  const { storage } = input.modules;
  const validators = new Validators(data);
  const words = bannedWords(data.BannedWordTable);
  const judges = new RequirementJudges();
  let phase: Phase = 'created';

  return {
    validate_request: (requestName, message) => validators.request(requestName, message),
    validate_message: (messageName, message) => validators.message(messageName, message),
    is_in_range: isInRange,
    has_table_id: (table, id) => hasTableId(data, table, id),
    is_unique: isUnique,
    is_plain_text: (text, maxCodePoints) => isPlainText(text, maxCodePoints, false),
    normalize_text: normalizeText,
    check_text: (text, maxCodePoints, allowNewline) => checkText(words, text, maxCodePoints, allowNewline),
    is_kind_consistent: isKindConsistent,
    floor_div,
    floor_mod,
    apply_permille,
    big_floor_div,
    big_apply_permille,
    is_platform: isPlatform,
    parse_version: parseVersion,
    compare_versions: compareVersions,
    register_requirement_judge: (type, judge) => {
      if (phase === 'started') throw new Error('register_requirement_judge: called after the server started');
      if (phase === 'registering') judges.register(type, judge);
      else judges.outsideRegister();
    },
    evaluate_requirement: (ctx, requirementId) => {
      if (requirementId === 0) return { passed: true, failed_requirement_id: 0 };
      const evaluation = new RequirementEvaluation(ctx, judges);
      return storage.run_read_only(ctx, () => evaluation.condition(requirementId));
    },
    begin_start: () => {
      phase = 'registering';
    },
    complete_start: () => {
      phase = 'started';
      const errors = [...judges.startErrors(data.RequirementTable), ...emptyBannedWords(words)];
      return errors.length === 0 ? null : errors.join('; ');
    },
    stop: () => {
      // Nothing to release: judge hooks and banned words live as long as this module object.
    },
  };
}
