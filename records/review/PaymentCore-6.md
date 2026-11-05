# PaymentCore review round 6

## findings

none

## previous

none. The review file of round 5 has no findings and no `open` rows

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range changes no file under `client/godot/core/payment_core/`. The changes in the range that PaymentCore reaches were read: `UICore.open_system_popup` now waits for the tween presets of a system popup prefab before it shows it (`client/godot/core/ui_core/ui_core.gd:529`–`:543`), and `payment_core.gd:497` already waits for it with `await` and checks `_life` and the login epoch after it (`:389`); the test data `test-data/data/tables/iap_product.csv` gained `[iap_unsold]` (no SKU) and `[iap_vip_google_only]` (`GOOGLE` SKU only), which `_build_sku_table` (`payment_core.gd:330`) leaves out of or adds to the SKU table by the empty SKU rule; the server `iap` change (`server/core/iap/adapters/apple.ts`) does not change a contract message or a `PurchaseStatus` that PaymentCore reads
- The spec diff changes no line of `payment-core.md`. Its changes to `ui-core.md` (system popup areas, `UIOpenedEvent` and `PanelFlowFinishedEvent` order, the error table of panel and popup prefab roots), `godot.md` (`SceneCore` rows), `core/SKILL.md`, `core/command.md` and `iap.md` (`iap-google` subscription verification) set no behavior that PaymentCore calls or relies on, so no PaymentCore code or test differs from a changed definition
- `ogw core test godot PaymentCore` was run on this checkout and passed. No previous finding is a `test evidence` finding, so no defect was restored in a temporary copy
- A `UICore.close_all_popups` that comes while a guest warning system popup is still loading its tween presets now makes `open_system_popup` return `false` without the hidden callback (`ui-core.md:198`), so `purchase` gives `Rejected` with an error log (`payment-core.md:114`) and not `Cancelled` (`payment-core.md:266`, written for a popup that is open). This follows the two specs and was read in the code, not run; it is not written as a finding
- The problem recorded as D12 in `records/review-debt/PaymentCore.json` (`list_unfinished` and `list_owned` failure log after the login session ended, `payment_core.gd:597`, `:640`) is unchanged in the range and is not written again in `## out of scope`
- Parts of PaymentCore that the range did not reach (plugin store adapter, subscription and pass lookup, daily claim) were not reviewed again
