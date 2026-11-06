# review PaymentCore round 1

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

- The commit range de482eec..63b1acf2 changes no file under `client/godot/core/payment_core/` and no definition that PaymentCore reads: it changes QACore, CameraCore, PoolCore, ScreenEffectCore, SoundCore, TweenCore and the QACore core settings keys `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs` (settings/core-settings.json, settings/core-settings.schema.json, client/godot/generated/core_settings.json, client/godot/generated/core_settings_types.json). PaymentCore code does not reference those modules or keys; the PaymentCore core test setup (client/godot/core/payment_core/tests/support/payment_test_case.gd:92-99) calls `PoolCore.init`, `SoundCore.init`, `TweenCore.init`, whose new DEV states (effect skip, DEV mute, play skip, finite skip) are off unless QACore sets them. `ogw core test godot PaymentCore` passed at 63b1acf2
- The real store adapter `client/godot/core/payment_core/adapters/plugin_store_adapter.gd`, the fake store adapter under `client/godot/core/payment_core/dev/adapters/` and the PaymentCore test files were not reviewed line by line, because the range does not change them. `payment_core.gd`, `payment_request.gd`, `payment_wait.gd`, `payment_guest_choice.gd`, `payment_core_node.gd`, `adapters/store_adapter.gd` and `dev/payment_core_dev.gd` were read against the spec for out-of-scope problems, and none of severity medium or higher with confidence 80 or more was found
- The store-side behavior of the real adapters (Apple, Google SDK) cannot be checked on this host
