# review iap round 3

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D3 | fixed | none | The spec lines that D3 relied on changed after D3 was written (debt list commit d4c4be0, 2026-11-04). Harness commit b6dcbc1 (2026-11-05) removed "When `bundleId` differs from `appId`, or `appAppleId` of production environment data differs from `iapApple.appAppleId`, the receipt verification result is `INVALID`" from the Apple adapter paragraph. Now `open-game-works-core/skills/server-core/modules/iap.md:340` uses the `appAppleId` comparison only for notifications ("A notification whose `data` has ... `environment` `Production` and an `appAppleId` that differs from `iapApple.appAppleId`, has a wrong signature"), and `iap.md:324` describes `iapApple.appAppleId` as compared only with "`appAppleId` of the `data` of production store notifications". For receipts the spec says "The result is `INVALID` when the verified payload has a `revocationDate` other than `null` or its app ID differs from `appId`, and `VALID` otherwise", and `server/core/iap/adapters/apple.ts:184`-`186` does exactly that (`revoked \|\| other_app`, with `other_app = transaction.app_id !== options.bundle_id`). The notification check is at `server/core/iap/adapters/apple.ts:193` and tested at `server/core/iap/tests/adapters.test.ts:316` (`environment` `Production`, `appAppleId` 9 gives `bad_signature`), and the receipt `bundleId` check is tested at `server/core/iap/tests/adapters.test.ts:275`. The code no longer differs from the defining documents |

## must fix

none

## unknown

- The commit range is empty (`01bd6d7..01bd6d7`), and the core agent reports and spec changes are `none`. So this round only re-decided debt item D3 against the current defining documents. iap code was not reviewed again
- D3 was decided by reading the spec history (`git log` / `git show` of `skills/server-core/modules/iap.md` in the harness), the current spec text and the adapter code and tests. No tests were run in this round, because no code changed and no `test evidence` finding needed a restored defect
