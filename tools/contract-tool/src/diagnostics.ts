import type { Pos } from './ast.ts';

/** Violations found before generation: one stdout line each. */
export class Diagnostics {
  private readonly items: { pos: Pos; message: string }[] = [];

  error(pos: Pos, message: string): void {
    this.items.push({ pos, message });
  }

  get count(): number {
    return this.items.length;
  }

  /** Lines `<file>:<line>:<column> ERROR <message>`, by file, line and column, without repeats. */
  lines(): string[] {
    const sorted = [...this.items].sort((a, b) =>
      a.pos.file < b.pos.file ? -1 : a.pos.file > b.pos.file ? 1 : a.pos.line - b.pos.line || a.pos.column - b.pos.column);
    const lines = sorted.map((d) => `${d.pos.file}:${String(d.pos.line)}:${String(d.pos.column)} ERROR ${d.message}`);
    return lines.filter((line, i) => lines.indexOf(line) === i);
  }
}

/** Failure of the arguments or of an input file the tool cannot read: exit code 2. */
export class InputFailure extends Error {}
