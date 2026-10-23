class_name UpdateSource
extends RefCounted
## Input of `GameUpdateCore.check_update`. `BootstrapCore` fills it from the build info fields of the same names.

## This app's version, `<major>.<minor>.<patch>`. Empty in a dev run.
var app_version: String = ""
## `LOCAL`, `DEV`, `STG` or `PROD`.
var environment: String = ""
## Build info `platform`: `android`, `ios`, `web`, `windows`, `macos` or `linux`.
var platform: String = ""
## Deploy list URL. Empty in a dev run.
var game_update_url: String = ""
## Trusted deploy list signing keys: the standard base64 of the Ed25519 public key (32 bytes) by key ID.
var update_trust_keys: Dictionary[String, String] = {}
