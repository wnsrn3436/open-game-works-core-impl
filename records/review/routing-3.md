# review routing round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | `secret_reader` now takes the store folder (`server/core/routing/start_parts.ts:191`), and `server/core/routing/server.ts:242` passes `HOST_SECRET_DIR` (`/run/secrets`, `start_parts.ts:185`). The new test `server/core/routing/tests/secret-store.test.ts` reads files with no newline, one newline, two newlines (only one removed), an inner newline and an empty file. It also checks null for a missing file, `''`, `.`, `..`, a folder, `nested/key` and `../above`, that `--secret-file` values win over the store, and that `HOST_SECRET_DIR` is `/run/secrets`. I restored the defect in a temporary copy of `server/` in the scratchpad, outside the checkout, and ran only that test file with vitest (globals) from the harness `tools/node_modules`. The unchanged copy passed 4 of 4. With `start_parts.ts:196` replaced by `return null;`, test "reads a secret as the file content without one trailing newline" failed (1 failed, 3 passed). With `.replace(/\r?\n$/, '')` removed from line 196, the same test failed (1 failed, 3 passed) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same problem as R2-1, which is now fixed. A value read from a store file and the removal of one trailing newline are now exercised by `server/core/routing/tests/secret-store.test.ts:32-40`, and that test fails when either defect is restored (see `## previous` R2-1) |

## must fix

none

## unknown

- In the commit range, the routing changes are only `server/core/routing/start_parts.ts`, `server/core/routing/server.ts` and the new `server/core/routing/tests/secret-store.test.ts`. The other changed files (nickname tests, review records, review-debt JSON) belong to other targets and were not reviewed.
- `server/core/routing/server.ts:242` passes `HOST_SECRET_DIR` to `secret_reader`. No test checks that a running server without `--secret-file` reads from that folder. If line 242 passed a different folder, every test would still pass. I did not write this as a finding: it is one line of wiring, the constant has its own test, the R2-1 fix direction proposed exactly this split, and a check from the server image would need a container with a file mounted at `/run/secrets/<name>`. The fix report says the same in `## unverified`.
- `secret_reader` also strips a trailing `\r\n` as one newline (`/\r?\n$/`). `server-core` `server-image.md:11` says only "without one trailing newline". No test checks CRLF. This code existed before the range and its confidence is below 80, so it is not a finding. The fix report has a spec proposal on it.
- `secret_reader` rejects names that contain `/` but not names that contain `\`, while `read_data_file` (`start_parts.ts:174`) rejects both. In the Linux server image, `\` is an ordinary file name character and cannot leave the store folder, so I did not treat it as a problem.
- I ran no other test files. I did not run the full routing suite, the server image tests or the PostgreSQL runs, because the change only touches `secret_reader` and its one caller. The fix report says the last `ogw core test server routing testing` passed.
