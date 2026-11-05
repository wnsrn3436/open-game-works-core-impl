# review data-tool round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range changes only `tools/data-tool/src/checks/InputCore.ts` and `tools/data-tool/tests/input-core-check.test.ts` (commit e09ca62). Checked against the `input_prompt` data check of the `InputCore` spec `## data` and the input prompt token rules of `data` SKILL.md `### format`: the source text of `name` and the `text` of every other language's translation file are checked; rows whose `id` starts with `#` are excluded by the loader (`src/load.ts:125`); translation files are aligned in memory before the checks run (`src/run.ts` `matchData` before `runChecks`), so keys match `translationKey` before ID value replacement.
- Ran `tests/input-core-check.test.ts` in a copy of HEAD outside the checkout: 9 passed. Removing the source-language skip in that copy makes the test `a name text of any language with an input prompt token is translation_format` fail with an extra `data/translations/en.csv` line, so the skip is covered.
- The rest of the data tool was not reviewed, because it did not change in this range and no change in the range calls into it other than `tokensOf`, `translationKey`, `keyPart`, `cellText`, `flatText`, `cellPlace`, `flatPlace`, whose behavior was read but not re-reviewed.
- The whole data-tool test suite was not run; only the test file of the changed code.
