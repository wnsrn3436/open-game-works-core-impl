/** Core test fixture `text-format` (`LocalizationCore` `## test`), read with `testing`'s `read_core_fixture`. */
import { read_core_fixture } from '../../testing/dev/index.ts';

export interface FormatCase {
  readonly name: string;
  readonly input: { readonly kind: 'int' | 'float' | 'string'; readonly value: string; readonly text: string; readonly language: string };
  readonly expected: string | null;
}

/** The cases of core test fixture `text-format` a `PushArg` can carry: `int` and `string` values. */
export function push_cases(): FormatCase[] {
  const cases = (JSON.parse(new TextDecoder().decode(read_core_fixture('text-format'))) as { cases: FormatCase[] }).cases;
  return cases.filter((c) => c.input.kind !== 'float');
}
