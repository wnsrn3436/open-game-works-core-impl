# update core: ads-reward

## done

- Reproduced on main: `ogw core test server ads-reward` failed on SQLite and PostgreSQL in `claim.test.ts` and `fake-callback.test.ts` ("... not a lower-case UUID v4, U+0000 included"), `expected 1 to be 32` (`CORE_ERROR_INVALID_REQUEST` instead of `CORE_ERROR_AD_REWARD_NOT_FOUND`).
- Cause checked: `server/generated/contract/wire.ts:638` returns rule `nul` for a `string` field holding U+0000, and `server/core/routing/pipeline.ts:501-504` (step 11 field validation) ends the request with `INVALID_REQUEST` before the handler. This is the `validation` spec (`## test`: a `string` field that holds U+0000 fails with rule `nul`, the request is `INVALID_REQUEST` without calling the handler). The `ads-reward` spec has no U+0000 test item, so the two old tests expected a result that no spec sets.
- Tests changed to follow the specs, no ads-reward or validation behaviour changed:
  - `server/core/ads-reward/tests/claim.test.ts`: the malformed-ID test now sends only IDs without U+0000 (upper-case UUID, UUID with a non-hex last character, `a`, empty) and keeps `AD_REWARD_NOT_FOUND` at once without an error log. New test: IDs `a\u0000b`, UUID prefix + `\u0000`, `\u0000` get `INVALID_REQUEST` at once with DEV detail of step 11 ending in `notify_id nul`, no error log, and the real ticket still answers `AD_REWARD_PENDING` afterwards.
  - `server/core/ads-reward/tests/fake-callback.test.ts`: same split. The U+0000 test also checks no grant (GEM balance 0, no `AdRewardCountUserState`), which shows the handler was not called, and that a later `FakeAdCallback` of the real ID grants.
- Last runs: `ogw core test server ads-reward routing testing` (ads-reward + `ogw core dependents ads-reward` server modules): all pass on SQLite and PostgreSQL. `ogw code check core`: type check, lint, dependency, secret pass.
- No engine-specific implementation rules document written; `## <engine> build` of `tools/ogw.md` not written.

## spec proposals

- `validation` `## DEV` says the `ServerError.detail` of a validator failure is `<field path>: <rule>`, while routing writes `step 11 field validation: <field path> <rule>` (`server/core/routing/pipeline.ts:503`; `routing` spec only says "the failed step and the reason"). Proposal: make the two specs agree on one form (e.g. `step 11 field validation: <field path>: <rule>`). The new tests accept both forms (`/^step 11 .*\bnotify_id:? nul$/`) so they do not depend on which wording is chosen.
- `ads-reward` `## test` could state the split explicitly: a reward notify ID with U+0000 is `INVALID_REQUEST` (validator rule `nul`, `ClaimAdReward` and `FakeAdCallback`), other IDs that are not a lower-case UUID v4 are `AD_REWARD_NOT_FOUND` without an error log.

## review

none

## unverified

- The comment at `server/core/ads-reward/index.ts:106` still says that a statement with U+0000 in a parameter fails; that path is no longer reachable from `ClaimAdReward`/`FakeAdCallback` because the validator rejects first. Left unchanged (input: change no ads-reward behaviour); it is only a comment.
