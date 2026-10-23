extends RefCounted
## What `BootstrapCore` asks of its DEV entry. The DEV entry extends this script and overrides every method. A
## build without DEV code has no DEV entry, and `BootstrapCore` does not call these.

const _UPDATE_SET := preload("res://core/bootstrap_core/update_set.gd")


## Build info of a dev run, made from the launch values. `null` when a launch value is invalid; the error log is
## then left.
func make_dev_build_info() -> BuildInfo:
	return null


## Passes the held test replacements in `InitModules` 2: test clock, `NetworkTransport`, log listener.
func apply_test_replacements() -> void:
	pass


## The update downloads of the held test replacements, the files `ApplyUpdate` takes instead of the `GameUpdateCore`
## downloads. `null` when there are none.
func test_update_downloads() -> _UPDATE_SET:
	return null


## Passes the realtime transport of the DEV code in `InitModules` 2. Returns whether it passed one.
func pass_realtime_transport() -> bool:
	return false


## Gives `AuthCore` the DEV token storage in `InitModules` 2.
func pass_dev_token_storage() -> void:
	pass


## The DEV fake social adapter of `AuthCore`.
func make_fake_social_adapter() -> SocialAdapter:
	return null


## The DEV fake push adapter of `PushCore`.
func make_fake_push_adapter() -> PushAdapter:
	return null


## The DEV fake notification adapter of `PushCore`.
func make_fake_notification_adapter() -> NotificationAdapter:
	return null


## The DEV fake store adapter of `PaymentCore` for store `store`.
func make_fake_store_adapter(_store: CoreContract.IapStore) -> StoreAdapter:
	return null


## The DEV fake ads adapter of `AdCore`.
func make_fake_ads_adapter() -> AdsAdapter:
	return null


## The DEV fake native adapter of `NativeUiCore`.
func make_fake_native_ui_adapter() -> NativeUiAdapter:
	return null


## The realtime transport the DEV code makes of the P2P transport `p2p`: the network simulation transport wrapped by
## the lockstep transport in a dev run, the lockstep transport in a DEV build with a build info file.
func wrap_realtime_transport(p2p: RealtimeTransport) -> RealtimeTransport:
	return p2p


## Runs after `InitModules` 3: the touch emulation.
func after_init_modules() -> void:
	pass


## Runs after `InitModules` 5: passing the dev access.
func after_server_info() -> void:
	pass


## Runs after `ContentInit` 2: the DEV registration list.
func after_derived_containers() -> void:
	pass


## Module list entries of the DEV modules. The boot adds them at the end of a module list of a boot without test
## replacements, and `shutdown` releases them first.
func dev_modules() -> Array[CoreModuleEntry]:
	return []


## Dev account name of the dev login. Empty when the boot does not use the dev login.
func dev_account() -> String:
	return ""


## Dev login with the dev account name. Async operation.
func dev_login() -> LoginResult:
	return null
