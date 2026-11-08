# review contract-tool round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit ebc01674 (inside the range 3c2809f9..679ee21a, an empty follow-up commit to ee58cbae) gives the cause the `nul` rule fixes (a `string` field holding U+0000 passed the generated validator, decode keeps it unchanged, and the first DB statement using it failed, so routing answered `INTERNAL` instead of `INVALID_REQUEST`), how it was reproduced (the `nul` line removed from `tools/contract-tool/src/gen/wire-source.ts` and `server/generated/contract/wire.ts`; `server/core/validation/tests/request.test.ts` got `{ code: 0 }` for nickname `"A\u0000B"`), and the evidence (`skills/server-core/modules/validation.md:77` and `:172`, `skills/server-core/modules/storage.md:311`, `skills/contract/tool.md:14`, `server/core/storage/tests/abort.test.ts:576`). The cited lines exist and say what the message states. This satisfies `## harness writing rules` of AGENTS.md for a commit that changes a rule |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range 3c2809f9..679ee21a changes only files under `records/` (review files of other targets and the fix report). No file under `tools/contract-tool/`, `server/`, `client/` or `benchmark/` changed (`git diff --stat` on those paths is empty), so no code or test of the contract tool was read for new findings in this round
- The reproduction stated in ebc01674 and in the fix report (removing the `nul` line and running the request test on SQLite and PostgreSQL) was not rerun; only that the commit message gives the cause and evidence was checked, which is what R1-1 asked for
