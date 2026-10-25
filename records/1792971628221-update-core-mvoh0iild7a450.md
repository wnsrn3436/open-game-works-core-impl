# update core: QACore (client, Godot) captureJpgQuality range 10 to 1000

## done

- `settings/core-settings.schema.json`: `QACore.captureJpgQuality` `minimum` 1 → 10 (`maximum` stays 1000)
- `client/godot/core/qa_core/dev/qa_core.gd`: new `_MIN_JPG_QUALITY` (10); `_read_settings` uses it as the least value of `QACore.captureJpgQuality`, so a value under 10 fails `init` with an error log like the other integer settings under their least value (a value over 1000 already failed the same way)
- `client/godot/core/qa_core/tests/test_render_capture.gd` `test_capture_formats`: besides quality 10 and 1000 encoding, quality 9 and 1001 each fail `init`, leave QACore uninitialized and log one error
- `ogw core test godot QACore`: pass. `ogw core test godot QACore --web`: pass. `ogw code check core`: pass

## spec proposals

none

## review

none

## unverified

none
