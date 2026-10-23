class_name LoginAppleAdapter
extends SocialAdapter
## Real `login-apple` adapter: Sign in with Apple through the `ogw-apple-signin` plugin singleton on `ios` and
## `macos`. `start_sign_in` returns an operation ID, and `take_result` returns an empty array until the sign-in ends,
## then `[<status>, <identity token>, <authorization code>]` once. Status 0 is success, 1 cancelled, 2 failed.
## `cancel(id)` tells the plugin that the adapter stopped waiting for sign-in `id`: the plugin drops its result. The
## adapter reads the plugin once a frame until the result comes or `stop`; the sign-in waits for the user and has no
## time limit.

const _SINGLETON: String = "OgwAppleSignIn"

## New object every `stop`: a sign-in wait that finds another object ends.
var _life: RefCounted = RefCounted.new()


func is_supported(platform: String) -> bool:
	return platform == "ios" or platform == "macos"


func sign_in() -> SignInResult:
	if not Engine.has_singleton(_SINGLETON):
		return SignInResult.new(SignInStatus.FAILED)
	var plugin: Object = Engine.get_singleton(_SINGLETON)
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_sign_in()
	if id <= 0:
		return SignInResult.new(SignInStatus.FAILED)
	var life: RefCounted = _life
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null and life == _life and is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		var raw: PackedStringArray = plugin.take_result(id)
		if raw.size() == 3:
			return _result(raw)
		if raw.size() != 0:
			return SignInResult.new(SignInStatus.FAILED)
		await tree.process_frame
	if is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		plugin.cancel(id)
	return SignInResult.new(SignInStatus.FAILED)


func stop() -> void:
	_life = RefCounted.new()


func _result(raw: PackedStringArray) -> SignInResult:
	if raw[0] == "1":
		return SignInResult.new(SignInStatus.CANCELLED)
	if raw[0] != "0" or raw[1].is_empty() or raw[2].is_empty():
		return SignInResult.new(SignInStatus.FAILED)
	var credential: Dictionary[String, String] = {"identity_token": raw[1], "authorization_code": raw[2]}
	return SignInResult.new(SignInStatus.SUCCESS, JSON.stringify(credential))
