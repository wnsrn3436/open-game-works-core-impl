# review: gacha round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `server/core/gacha/index.ts:284` now gives each `GachaDrawResult` its own items (`copy_item`, a full copy of `item_id`, `amount`, `big_amount`, the three fields of `ItemAmount` in `proto/ogw/core.proto:1757`). Restored in a temporary copy (line 284 back to `draw.items = [...result.items];`): `draw.test.ts` "grant_gacha_result changing its input items in place changes neither the GachaDrawResult nor the draw record" fails; the other 41 gacha tests pass |
| R1-2 | fixed | `server/core/gacha/index.ts:390` passes `draws.results.map(copy_draw)` to `on_gacha_drawn`, and line 396 returns `draws.results`. Restored in a temporary copy (the hook gets `draws.results` again): `draw.test.ts` "on_gacha_drawn changing its input list and messages does not change the response, which stays the saved draw records" fails |
| R1-3 | fixed | Test `draw.test.ts:270` with banners `[gacha_banner_roll_over]` and `[gacha_banner_sum_over]`. Restored in a temporary copy, separately: `index.ts:276` changed to `if (result === undefined) continue;` (skip the round), and `index.ts:298` changed to return `[]` for a `sum_items` failure. Each makes "a loot-table roll failure and a sum_items failure are INTERNAL, and the cost, pity state and draw records stay" fail |
| R1-4 | fixed | Test `draw.test.ts:286`. Restored in a temporary copy (`index.ts:319` returns `{ items: [], mailed: false }` for every failure value of `grant_or_mail`): "a grant that mailbox.grant_or_mail fails is INTERNAL, and the cost, pity state and draw records stay" fails |
| R1-5 | fixed | The hook output test now also gives `{}`, `'pass'`, `[{ item_id: 'x' }]`, a list with a number `amount` and `[null]` (`draw.test.ts:494`). Restored in a temporary copy (`index.ts:304` returns `[]` when `granted_items` is null): "judges validate_gacha_draw and grant_gacha_result by storage.check_hook_output: ..." fails |
| R1-6 | fixed | Test `draw.test.ts:304` calls `get_pity` through the core object. Restored in a temporary copy, separately: `index.ts:459` returning `{ count: 0, rate_up_guaranteed: false }` always, and `index.ts:459` reading the banner's own state instead of the pity owner's. Each makes "get_pity is the pity state of the pity owner, and (0, false) for an unknown banner" fail |
| R1-7 | fixed | Banner `[gacha_banner_window_locked]` and test `draw.test.ts:376`. Restored in a temporary copy (the requirement check of `index.ts:248` moved before the window check): "a banner outside its window whose requirement does not pass is GACHA_BANNER_UNAVAILABLE, and GACHA_BANNER_LOCKED inside it" fails |
| R1-8 | fixed | The rate-up test now checks the stored `rate_up` through `ListGachaHistory` and `list_gacha_history` (`draw.test.ts:140-145`). Restored in a temporary copy (`records.ts:132` `bool` returns `false`): "on a rate_up_guarantee banner, the pity tier after one that missed the rate-up rolls rate_up_table, and then g is false" fails at `draw.test.ts:141`, and the R1-2 test also fails |

## out of scope

- server/core/gacha/records.ts:32: medium `draw_seq` is given as `MAX(draw_seq) + 1` over all the user's draw records, with no `expires_at > clock_now` condition, so an expired draw record that `sweep_expired` has not deleted yet still counts. `storage` `### expiry` (storage.md:269) says such a row counts as a row that does not exist, and `gacha` `## storage` gives `draw_seq` from the largest value among that user's draw records + 1, or 1 when there is none. Probe in a temporary copy: `gacha.historyRetentionMs` 60000, `routing.storageSweepIntervalMs` 3600000, one `DrawGacha` on `[gacha_banner_main]`, `advance_time` 60000, a second `DrawGacha`: `ListGachaHistory` returns one row with `draw_seq` 2, where the documents give 1. So `draw_seq` depends on sweep timing. This existed before the range; it is the same defect that commit c9f9ab8 of this range fixed in `item-ledger` `insert_history` (MAX over live rows plus an upsert over the expired row of that key)

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1 in `## previous`: `index.ts:284` copies the items, and the restored defect fails `draw.test.ts:227` |
| D2 | fixed | none | Same as R1-2: `index.ts:390` gives the hook copies, and the restored defect fails `draw.test.ts:247` |
| D3 | fixed | none | Same as R1-3: both restored defects (roll round skipped, `sum_items` failure as an empty list) fail `draw.test.ts:270` |
| D4 | fixed | none | Same as R1-4: the restored defect fails `draw.test.ts:286` |
| D5 | fixed | none | Same as R1-5: the restored defect fails the hook output test |
| D6 | fixed | none | Same as R1-6: both restored defects fail `draw.test.ts:304` |
| D7 | fixed | none | Same as R1-7: the swapped checks fail `draw.test.ts:376` |
| D8 | fixed | none | Same as R1-8: `bool` returning `false` fails `draw.test.ts:141` |

## must fix

none

## unknown

- Tests and restored defects were run only on SQLite (`OGW_DEFAULT_DB=sqlite`), in a copy of the checkout in a temporary folder with the built data of `open-game-works-core-impl/server/build/data` (same commit 9361609), using the vitest that ogw pins. PostgreSQL was not run. The unchanged copy passes all 42 gacha tests.
- The modules that depend on gacha and the other modules that use the new core test data rows (3 banners, 3 loot table rows) were not run; `ogw review run` runs the dependents after the fix.
- The other changes of the range (item-ledger, game-update, notice, rating and others) were read only where gacha calls them (`item-ledger` history writes reached through `mailbox.grant_or_mail`). They were not reviewed as targets.
- Removing the unknown-banner check of `get_pity` (`index.ts:458`) fails no test, but the result stays `(0, false)` in that case (the probe run gives it), so no behavior differs and it was not written as a finding.
