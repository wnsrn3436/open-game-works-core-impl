/**
 * Requirement judge hooks and the evaluation of `requirement` rows, with the condition and combination rules of
 * client `RequirementCore`.
 */
import * as GameData from '../../generated/data/game_data.ts';
import type { RequestCtx } from '../storage/index.ts';

/** The output of `evaluate_requirement`. `failed_requirement_id` is the first failed condition, 0 when passed. */
export interface RequirementResult {
  readonly passed: boolean;
  readonly failed_requirement_id: number;
}

/** Requirement judge hook: the self judgement of one `RequirementType` element. */
export type RequirementJudge = (ctx: RequestCtx, row: GameData.RequirementRow) => boolean;

const PASSED: RequirementResult = { passed: true, failed_requirement_id: 0 };

/** The self judgement item of a row, before its child conditions. */
const SELF = 0;

function typeName(type: number): string {
  const entry = Object.entries(GameData.RequirementType).find(([, value]) => value === type);
  return entry === undefined ? String(type) : entry[0];
}

const KNOWN_TYPES: ReadonlySet<number> = new Set(Object.values(GameData.RequirementType));

/** Judge hooks by `RequirementType` element, and the registration errors that stop the server start. */
export class RequirementJudges {
  private readonly judges = new Map<number, RequirementJudge>();
  private readonly errors: string[] = [];

  /** Records a registration; a wrong one becomes a server start failure reason. */
  register(type: number, judge: unknown): void {
    if (typeof judge !== 'function') this.errors.push(`the judge hook of RequirementType ${typeName(type)} is not a function`);
    else if (type === GameData.RequirementType.None) this.errors.push('RequirementType None cannot have a judge hook');
    else if (!KNOWN_TYPES.has(type)) this.errors.push(`${String(type)} is not a RequirementType element`);
    else if (this.judges.has(type)) this.errors.push(`RequirementType ${typeName(type)} has a judge hook already`);
    else this.judges.set(type, judge as RequirementJudge);
  }

  /** Records a registration made outside the content `register`. */
  outsideRegister(): void {
    this.errors.push('register_requirement_judge was called outside register');
  }

  /** Server start failure reasons: registration errors, then types of `requirement` rows that have no judge hook. */
  startErrors(table: GameData.RequirementTable): string[] {
    const missing = new Set<number>();
    for (const row of table.all_rows()) {
      if (row.type !== GameData.RequirementType.None && !this.judges.has(row.type)) missing.add(row.type);
    }
    const out = [...this.errors];
    for (const type of [...missing].sort((a, b) => a - b)) {
      out.push(`RequirementType ${typeName(type)} is in the requirement table and has no judge hook`);
    }
    return out;
  }

  get(type: number): RequirementJudge | undefined {
    return this.judges.get(type);
  }
}

/** One evaluation of a requirement ID value in a ctx. Every self judgement calls its judge hook; there is no cache. */
export class RequirementEvaluation {
  private readonly ctx: RequestCtx;
  private readonly judges: RequirementJudges;
  private readonly table: GameData.RequirementTable;
  private readonly path = new Set<number>();

  constructor(ctx: RequestCtx, judges: RequirementJudges) {
    this.ctx = ctx;
    this.judges = judges;
    this.table = ctx.data.RequirementTable;
  }

  /** The result of a condition: its items in order, stopping at the stop item. */
  condition(id: number): RequirementResult {
    if (!this.table.has_row(id)) throw new Error(`requirement ${String(id)} is not in the requirement table`);
    if (this.path.has(id)) throw new Error(`requirement ${String(id)} is its own child condition`);
    const row = this.table.get_row(id);
    const items = row.type === GameData.RequirementType.None ? [...row.children] : [SELF, ...row.children];
    if (items.length === 0) throw new Error(`requirement ${String(id)} has no type and no child condition`);
    this.path.add(id);
    try {
      return row.logic === GameData.RequirementLogic.Any ? this.any(row, items) : this.all(row, items);
    } finally {
      this.path.delete(id);
    }
  }

  /** `All` (and `None`, whose only item is the self judgement): the first failed item is the stop item. */
  private all(row: GameData.RequirementRow, items: readonly number[]): RequirementResult {
    for (const item of items) {
      const result = this.item(row, item);
      if (!result.passed) return result;
    }
    return PASSED;
  }

  /** `Any`: the first passed item is the stop item; when none passes, the first item names the failed condition. */
  private any(row: GameData.RequirementRow, items: readonly number[]): RequirementResult {
    let first: RequirementResult | null = null;
    for (const item of items) {
      const result = this.item(row, item);
      if (result.passed) return PASSED;
      first ??= result;
    }
    return first ?? PASSED;
  }

  private item(row: GameData.RequirementRow, item: number): RequirementResult {
    if (item !== SELF) return this.condition(item);
    const passed = this.self(row);
    return passed ? PASSED : { passed: false, failed_requirement_id: row.id };
  }

  private self(row: GameData.RequirementRow): boolean {
    const judge = this.judges.get(row.type);
    if (judge === undefined) throw new Error(`RequirementType ${typeName(row.type)} has no judge hook`);
    const passed: unknown = judge(this.ctx, row);
    if (typeof passed !== 'boolean') throw new TypeError(`the judge hook of RequirementType ${typeName(row.type)} did not return a boolean`);
    return passed;
  }
}
