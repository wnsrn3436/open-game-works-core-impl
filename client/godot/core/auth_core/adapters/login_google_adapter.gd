class_name LoginGoogleAdapter
extends SocialAdapter
## Real `login-google` adapter. On `android` and `ios` it signs in through the `ogw-google-signin` plugin singleton,
## in the browser runtime through Google Identity Services, and on `windows`, `macos` and `linux` through installed
## app OAuth with a loopback listener. A dev run that imitates `web` outside the browser uses the desktop flow.
##
## The plugin singleton: `start_sign_in(client_id)` returns an operation ID, and `take_result` returns an empty array
## until the sign-in ends, then `[<status>, <ID token>]` once. Status 0 is success, 1 cancelled, 2 failed. `cancel(id)`
## tells the plugin that the adapter stopped waiting for sign-in `id`: the plugin drops its result. Every flow reads
## its state once a frame until it ends or `stop`; only the desktop flow has a time limit.

const _SINGLETON: String = "OgwGoogleSignIn"
const _DESKTOP_SIGN_IN := preload("res://core/auth_core/adapters/google_desktop_sign_in.gd")
const _WEB_SIGN_IN := preload("res://core/auth_core/adapters/google_web_sign_in.gd")

## Game settings `loginGoogle.serverClientId`. AuthCore sets it in `init`.
var server_client_id: String = ""
## Game settings `loginGoogle.iosClientId`. AuthCore sets it in `init`.
var ios_client_id: String = ""
## Game settings `loginGoogle.desktopClientId`. AuthCore sets it in `init`.
var desktop_client_id: String = ""
## `AuthCore.desktopSignInTimeoutMs`. AuthCore sets it in `init`.
var desktop_timeout_ms: int = 0
## Opens a URL with the system browser and returns a success flag. AuthCore sets it in `init`.
var open_url: Callable = Callable()

## New object every `stop`: a plugin sign-in wait that finds another object ends.
var _life: RefCounted = RefCounted.new()
## Browser and desktop sign-ins that run. `stop` ends them.
var _flows: Array[RefCounted] = []


func is_supported(platform: String) -> bool:
	return platform in ["android", "ios", "web", "windows", "macos", "linux"]


func sign_in() -> SignInResult:
	var platform: String = CoreBuildInfo.platform
	if OS.get_name() != "Web" and (platform == "android" or platform == "ios"):
		return await _plugin_sign_in(server_client_id if platform == "android" else ios_client_id)
	var result: SignInResult = null
	if OS.get_name() == "Web":
		var web: _WEB_SIGN_IN = _WEB_SIGN_IN.new()
		_flows.append(web)
		result = await web.sign_in(server_client_id)
		_flows.erase(web)
	else:
		var desktop: _DESKTOP_SIGN_IN = _DESKTOP_SIGN_IN.new()
		_flows.append(desktop)
		result = await desktop.sign_in(desktop_client_id, desktop_timeout_ms, open_url)
		_flows.erase(desktop)
	return result


func stop() -> void:
	_life = RefCounted.new()
	var flows: Array[RefCounted] = _flows
	_flows = []
	for flow: RefCounted in flows:
		if flow is _WEB_SIGN_IN:
			(flow as _WEB_SIGN_IN).stop()
		elif flow is _DESKTOP_SIGN_IN:
			(flow as _DESKTOP_SIGN_IN).stop()


func _plugin_sign_in(client_id: String) -> SignInResult:
	if not Engine.has_singleton(_SINGLETON) or client_id.is_empty():
		return SignInResult.new(SignInStatus.FAILED)
	var plugin: Object = Engine.get_singleton(_SINGLETON)
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_sign_in(client_id)
	if id <= 0:
		return SignInResult.new(SignInStatus.FAILED)
	var life: RefCounted = _life
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null and life == _life and is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		var raw: PackedStringArray = plugin.take_result(id)
		if raw.size() == 2 and raw[0] == "1":
			return SignInResult.new(SignInStatus.CANCELLED)
		if raw.size() == 2 and raw[0] == "0" and not raw[1].is_empty():
			return SignInResult.new(SignInStatus.SUCCESS, raw[1])
		if raw.size() != 0:
			return SignInResult.new(SignInStatus.FAILED)
		await tree.process_frame
	if is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		plugin.cancel(id)
	return SignInResult.new(SignInStatus.FAILED)
