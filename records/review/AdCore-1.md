# review AdCore round 1

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

- The commit range de482eec..9069447b changes no file under `client/godot/core/ad_core/` and no AdCore spec, settings key or test. The only changed code that AdCore calls is `client/godot/core/sound_core/sound_core.gd`; the changes there (`_dev_mutes`, `_play_skip` in `play`, `_apply_bus`, `_start_sfx`, `_reset_state`) do not change `SoundCore.request_pause` or `SoundCore.release_pause` (sound_core.gd:427, sound_core.gd:436), which are the only SoundCore operations AdCore uses (client/godot/core/ad_core/ad_core.gd:90, ad_core.gd:220, ad_core.gd:232). The other changed modules (QACore, PoolCore, TweenCore, CameraCore, ScreenEffectCore) are not AdCore dependencies and are not called by AdCore. The QACore settings keys added to `settings/core-settings.json` do not touch the `AdCore.*` keys
- The AdCore code outside the changed places was not reviewed, because with a commit range only problems caused or revealed by the range are in scope
- The AdCore core tests were not run, because no finding needed checking
