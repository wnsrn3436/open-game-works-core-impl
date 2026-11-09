# review push round 1

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

- The commit range changes no file of `server/core/push/`. The changes checked for an effect on push are those of its dependencies: `server/core/storage/core.ts`, `server/core/storage/tx.ts`, `server/core/storage/index.ts` (new `fail_transaction`, and storage operations that throw on a marked transaction), `server/core/session/index.ts` (`end_session` in a request with a session deletes only the record of ctx `session_id`) and `server/core/logging/metrics.ts` (comment only). push does not call `fail_transaction`, and no game transaction function of push catches a storage throw (`server/core/push/send.ts`, `server/core/push/schedule.ts`), so a marked transaction ends `FAILED` with no push record left, which is what `queue_push` in a rolled-back transaction requires. push reads sessions only through `session.check_current` (`server/core/push/send.ts:277`, `server/core/push/send.ts:580`); after the `end_session` change, a device row of a logged-out session still fails `check_current` with `UNAUTHORIZED` or `SESSION_REPLACED` and is deleted
- `ogw core test server push` passed on this checkout. Which of its cases ran on PostgreSQL was not checked
- The push code outside the places above was not reviewed again, as the range does not change it
