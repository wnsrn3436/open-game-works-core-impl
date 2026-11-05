# review cheat round 1

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

- The range 51d323b..448cdc6 changes no file under `server/core/cheat/` and no cheat test. Checked the changes the cheat code calls or that handle cheat requests: `storage` (`tx.ts` `body` / `run_savepoint` / `lock_row` on a broken transaction, `core.ts` `mark_broken`, `state.ts` `get_states`, `rows.ts` `get_user_records`, `user_change.ts`), `routing` `http.ts` `client_ip` / `ip_text` and `pipeline.ts` `client_ip_of` (the client IP used by the `devAllowedCidrs` check in `server/core/routing/dev/index.ts`), and `logging` `log_line.ts` `truncate_ip`. None of them changes the paths cheat uses (`storage.db`, `put_state`, `delete_state`, `register_table`, `server-time.clock_now`, `register_offset_provider`) or the dev access, processing order and `audit` log behavior of `server/core/routing/dev/index.ts`
- Checked by run: `ip_in_cidrs(client_ip(0, null, '::ffff:10.0.0.1'), ...)` matches both `10.0.0.0/24` and `::ffff:10.0.0.0/120`, and a normalized IPv6 `X-Forwarded-For` value (`2001:DB8::1`) matches `2001:db8::/32`, so the new client IP text keeps the `devAllowedCidrs` check of the dev access section
- `ogw core test server cheat` passes on SQLite and PostgreSQL at 448cdc6
- The `## test` item "In DEV, one `audit` log line ..." was not checked against a server started with `--env DEV`; `server/core/cheat/tests/access.test.ts:114` runs it on the test server. This is not a change of the range
