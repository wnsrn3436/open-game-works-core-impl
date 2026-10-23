class_name CoreBuildInfo
extends RefCounted
## Build values `BootstrapCore` decides and the other core modules read: the build info `platform`, the app storage
## root and whether the build holds DEV code. Not a module.

## Path of the `BootstrapCore` DEV entry. A build holds DEV code when this file exists.
const DEV_ENTRY_PATH: String = "res://core/bootstrap_core/dev/bootstrap_core_dev.gd"
## App storage root before `BootstrapCore` decides one.
const DEFAULT_STORAGE_ROOT: String = "user://"

## Build info `platform`: `android`, `ios`, `web`, `windows`, `macos` or `linux`. The running OS's platform before
## `BootstrapCore` decides it and after `shutdown`.
static var platform: String = os_platform()
## App storage root: `user://` or `user://instances/<instance_id>/`.
static var storage_root: String = DEFAULT_STORAGE_ROOT
## Whether the build holds DEV code. Decided once, when the class is first read.
static var has_dev_code: bool = ResourceLoader.exists(DEV_ENTRY_PATH)


## Platform of the running OS. An OS outside the list gives an empty string.
static func os_platform() -> String:
	match OS.get_name():
		"Android":
			return "android"
		"iOS":
			return "ios"
		"Web":
			return "web"
		"Windows":
			return "windows"
		"macOS":
			return "macos"
		"Linux":
			return "linux"
	return ""
