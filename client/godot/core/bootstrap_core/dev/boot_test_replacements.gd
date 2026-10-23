class_name BootTestReplacements
extends RefCounted
## Test replacements a test passes to `BootstrapCore.start_boot`. `BootstrapCore` holds them until `shutdown` and
## passes them in `InitModules` 2 of every boot, restart and update reboot included. A field left at its default
## is none.

## Test clock for `TimeCore` and `LogCore`.
var test_clock: RefCounted = null
## `NetworkTransport` for `NetworkCore`.
var network_transport: NetworkTransport = null
## Log listener for `LogCore`: a function of level, tag and message.
var log_listener: Callable = Callable()
## Realtime transport for `RealtimeCore`. Passed as it is.
var realtime_transport: RefCounted = null
## Server URL. When not empty, the dev run build info `server_url`.
var server_url: String = ""
## Update downloads: the files `ApplyUpdate` takes instead of the ones `GameUpdateCore` downloaded.
var update_downloads: UpdateDownloads = null

## Core test only. Resource test key list passed to `ResourceCoreDev.set_test_key_list` in `InitModules` 2 of
## every boot, so a boot after a restart finds the test resources. Empty is none.
var _resource_keys: Dictionary[String, String] = {}


## Downloaded data, translations and bundles `ApplyUpdate` takes instead of the `GameUpdateCore` downloads.
class UpdateDownloads:
	extends RefCounted

	## Downloaded data. `null` when there is none.
	var data: DownloadedData = null
	var translations: Array[DownloadedTranslation] = []
	var bundles: Array[DownloadedBundle] = []
