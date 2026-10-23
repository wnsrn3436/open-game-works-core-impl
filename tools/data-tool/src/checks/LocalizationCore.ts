/**
 * Data checks of `LocalizationCore` `## data`: the `language` table has one row for each language of game settings
 * `supportedLanguages`. The BCP 47 form and the unique `code` are checked for every game (`check-tables.ts`).
 */
import { filePlace } from '../diag.ts';
import { cellPlace, cellText, column } from '../model.ts';
import type { ModuleCheck } from '../module-check.ts';

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('language');
  const code = table ? column(table, 'code') : undefined;
  if (!table || !code) return;
  const supported = Array.isArray(input.settings.supportedLanguages)
    ? input.settings.supportedLanguages.filter((l): l is string => typeof l === 'string')
    : [];
  const codes = new Set<string>();
  for (const row of table.rows) {
    const text = cellText(row, code);
    codes.add(text);
    if (!supported.includes(text)) {
      input.report('out_of_range', cellPlace(table, row, code), `language code ${text} is not in game settings supportedLanguages`);
    }
  }
  for (const language of supported) {
    if (!codes.has(language)) input.report('required_missing', filePlace(table.file), `language ${language} of game settings supportedLanguages has no language row`);
  }
};
