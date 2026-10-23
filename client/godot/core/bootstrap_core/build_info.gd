class_name BuildInfo
extends RefCounted
## Build info of `BootstrapCore`. `get_build_info` returns a copy.

## App ID.
var app_id: String = ""
## App version `<major>.<minor>.<patch>`.
var app_version: String = ""
## `LOCAL`, `DEV`, `STG` or `PROD`.
var environment: String = ""
## `android`, `ios`, `web`, `windows`, `macos` or `linux`.
var platform: String = ""
## Server base URL.
var server_url: String = ""
## Deploy list URL.
var game_update_url: String = ""
## Update trust keys: Ed25519 public key (base64) by key ID, in build info order.
var update_trust_keys: Dictionary[String, String] = {}
## Adapter name by adapter key.
var adapters: Dictionary[String, String] = {}
## Ad unit ID by placement ID value.
var ad_units: Dictionary[int, String] = {}
## Instance ID. Empty outside a dev run.
var instance_id: String = ""


## A new object with the same values.
func duplicate_info() -> BuildInfo:
	var copy := BuildInfo.new()
	copy.app_id = app_id
	copy.app_version = app_version
	copy.environment = environment
	copy.platform = platform
	copy.server_url = server_url
	copy.game_update_url = game_update_url
	copy.update_trust_keys = update_trust_keys.duplicate()
	copy.adapters = adapters.duplicate()
	copy.ad_units = ad_units.duplicate()
	copy.instance_id = instance_id
	return copy
