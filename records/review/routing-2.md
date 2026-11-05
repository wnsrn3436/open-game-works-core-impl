# review routing round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | test evidence | medium | server/core/routing/start_parts.ts:196 | Input debt D1 remains. `server-core` `SKILL.md:100` (`read_secret`) and `server-image.md:11` say that a server without `--secret-file` reads secret `name` from the file `/run/secrets/<name>`, and that the value is the file content without one trailing newline. `secret_reader(null)` (`start_parts.ts:191-200`) does this with the fixed constant `HOST_SECRET_DIR = '/run/secrets'` (`start_parts.ts:185`), and `server.ts:242` is its only caller. No test exercises it: `HOST_SECRET_DIR` and `secret_reader` appear only in `start_parts.ts` and `server.ts`, and no file under `server/core/*/tests/` names `run/secrets`. Tests that read secrets (`admin-api/tests/operators.test.ts:47`, `cheat/tests/access.test.ts:89`) give their own `read_secret` function. `server/core/routing/tests/server-image.test.ts` starts the image without `--secret-file` only with `--env NOT_AN_ENV` (line 129) and `--env STG` (lines 140, 151), and those runs mount nothing at `/run/secrets`. Its one run with a secret (line 176) uses `--secret-file`, so it takes the `file_values` branch. Because of this, replacing line 196 with `return null`, or removing the `.replace(/\r?\n$/, '')`, leaves every test passing | Add a test that reads a secret from the host secret store. One way: let `secret_reader` take the store folder as a parameter (`server.ts` passes `/run/secrets`), then test it with a temporary folder whose files end with no newline, one newline or two newlines, plus a missing file and a name containing `/`. Another way: start the STG image in `server-image.test.ts` with a file mounted at `/run/secrets/<name>` and check a behavior that reads that secret | no | 92 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R2-1 | The commit range `546cccd..546cccd` changes nothing. `start_parts.ts:185-200` and the tests are as D1 describes. The full evidence is in R2-1 |

## must fix

none

## unknown

- The commit range is empty (`546cccddbdf90275ee7f44bdb8c979485ababb2b..546cccddbdf90275ee7f44bdb8c979485ababb2b`), and there are no core agent reports. Round 1 (`records/review/routing-1.md`) had no findings, so `## previous` has no rows. The only code reviewed was the D1 position (`server/core/routing/start_parts.ts:184-200`), its caller `server/core/routing/server.ts:242`, and the tests that could reach it.
- No tests were run. The finding says that no test exists, which was checked by searching `server/` and `tools/` and by reading the `docker run` calls of `server-image.test.ts`. No defect had to be restored for a `test evidence` result.
- `secret_reader` also strips a trailing `\r\n` (`/\r?\n$/`). `server-image.md:11` says "one trailing newline" and does not say whether CRLF counts as one newline. This was not written as a finding: confidence is below 80, and the code is outside the commit range.
