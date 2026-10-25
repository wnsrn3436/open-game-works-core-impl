# review: offer round 1

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

- The range 2ef5ae8d..4bc36b7 changes no file under `server/core/offer/` (`git log -- server/core/offer` shows only the initial commit), and `## spec changes` is `none`. The changes in the range that offer reaches were checked against the offer code: `storage.create_user` now returns `NewUser` (`server/core/storage/rows.ts:57`) and its only caller is `server/core/auth/login.ts:76`, which offer tests reach only through `testing` login; schema version 2 adds `user.public_code` (`server/core/storage/schema.ts:218`), and offer reads and writes only `OfferUserState` through `get_state`, `put_core_state` and `delete_core_state`, whose signatures did not change; `proto/ogw/core.proto` changes `BanDetail`, `AuthResult`, `PublicProfileEntry` and the `FindUserByPublicCode` messages, not `OfferUserState`; `live-event`, `validation`, `server-time` and `logging` changed only test helpers. None of these changes causes or reveals a problem in offer
- The offer tests were not run: this worktree has no installed dependencies (`server/package-lock.json` lists no packages and there is no `node_modules`), so vitest is not available here. Whether `server/core/offer/tests/` still passes after the storage changes in the range was not checked by running them
- Client `UserStateCore.is_offer_active` and `get_offer_ends_at`, which `## behavior` says do the same calculation, are client core and outside this server module target; they were not checked
- The `## data` rules (`duration`, `cooldown`, `max_triggers`) are data checks under `core` (`skills/core/SKILL.md:166`) and were checked only as far as `tools/data-tool/src/checks/offer.ts` and `tools/data-tool/tests/offer-check.test.ts` existing; the data tool is not the target and was not reviewed
