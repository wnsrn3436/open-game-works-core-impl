class_name AdmobAdapter
extends AdsAdapter
## Real `ads-admob` adapter on `android` and `ios`: Google Mobile Ads SDK and Google UMP SDK through the
## `ogw-ads-admob` plugin singleton. An async plugin method returns an operation ID (0 when it could not start), and
## `take_result` returns an empty array until the operation ends, then its result once: `["0"]` is success, any other
## first element is failure. `request_consent` ends with `[<status>, <required 0|1>, <personalized 0|1>]` and
## `present` with `[<status>]` where 0 is completed, 1 aborted, 2 failed. The plugin keeps the UMP consent in the
## IAB TCF form the ads SDK reads, and `personalized` is true when the stored TCF consent has the Google vendor and
## purposes 1, 3 and 4. `cancel(id)` tells the plugin that the adapter stopped waiting for operation `id`: the plugin
## drops its result. The adapter reads the plugin once a frame until the result comes, the time limit passes or
## `release`. `initialize`, `load_ad` and `open_banner` end at `call_timeout_ms`; the operations that wait for the user
## (`request_consent`, `show_privacy_options`, `present`) have no time limit.

const _SINGLETON: String = "OgwAdsAdmob"
const _OK: String = "0"

## The ads SDK was initialized in this process.
static var _sdk_ready: bool = false

## New object every `release`: an operation wait that finds another object ends.
var _life: RefCounted = RefCounted.new()


func request_ad_consent() -> ConsentResult:
	var result: ConsentResult = ConsentResult.new()
	var plugin: Object = _plugin()
	if plugin == null:
		return result
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.request_consent()
	var raw: PackedStringArray = await _result_of(plugin, id, -1)
	if raw.size() != 3 or raw[0] != _OK:
		return result
	result.ok = true
	result.required = raw[1] == "1"
	result.personalized = raw[2] == "1"
	return result


func is_privacy_options_required() -> bool:
	var plugin: Object = _plugin()
	if plugin == null:
		return false
	@warning_ignore("unsafe_method_access")
	var required: bool = plugin.is_privacy_options_required()
	return required


func show_privacy_options() -> bool:
	var plugin: Object = _plugin()
	if plugin == null:
		return false
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.show_privacy_options()
	return _is_ok(await _result_of(plugin, id, -1))


func initialize(consent: AdConsent) -> bool:
	if _sdk_ready:
		return true
	var plugin: Object = _plugin()
	if plugin == null:
		return false
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.initialize(consent.ad_personalization_allowed, consent.child, consent.below_consent_age)
	_sdk_ready = _is_ok(await _result_of(plugin, id, call_timeout_ms))
	return _sdk_ready


func load_ad(ad_type: GameData.AdType, unit_id: String, consent: AdConsent) -> bool:
	var plugin: Object = _plugin()
	if plugin == null:
		return false
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.load_ad(_type_name(ad_type), unit_id, consent.ad_personalization_allowed, consent.child, consent.below_consent_age)
	return _is_ok(await _result_of(plugin, id, call_timeout_ms))


func present(ad_type: GameData.AdType, unit_id: String, verification: Verification) -> AdCore.AdShowResult:
	var plugin: Object = _plugin()
	if plugin == null:
		return AdCore.AdShowResult.FAILED
	var user_id: String = ""
	var custom_data: String = ""
	if verification != null:
		user_id = str(verification.user_id)
		custom_data = verification.notify_id
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.present(_type_name(ad_type), unit_id, user_id, custom_data)
	var raw: PackedStringArray = await _result_of(plugin, id, -1)
	if raw.size() != 1:
		return AdCore.AdShowResult.FAILED
	if raw[0] == "0":
		return AdCore.AdShowResult.COMPLETED
	if raw[0] == "1":
		# An interstitial ad that was shown and closed is completed.
		return AdCore.AdShowResult.ABORTED if ad_type == GameData.AdType.REWARDED else AdCore.AdShowResult.COMPLETED
	return AdCore.AdShowResult.FAILED


func open_banner(unit_id: String, consent: AdConsent) -> bool:
	var plugin: Object = _plugin()
	if plugin == null:
		return false
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.open_banner(unit_id, consent.ad_personalization_allowed, consent.child, consent.below_consent_age)
	return _is_ok(await _result_of(plugin, id, call_timeout_ms))


func close_banner() -> void:
	var plugin: Object = _plugin()
	if plugin != null:
		@warning_ignore("unsafe_method_access")
		plugin.close_banner()


func release() -> void:
	_life = RefCounted.new()
	var plugin: Object = _plugin()
	if plugin != null:
		@warning_ignore("unsafe_method_access")
		plugin.discard_ads()


static func _plugin() -> Object:
	if not Engine.has_singleton(_SINGLETON):
		return null
	return Engine.get_singleton(_SINGLETON)


static func _type_name(ad_type: GameData.AdType) -> String:
	return "rewarded" if ad_type == GameData.AdType.REWARDED else "interstitial"


static func _is_ok(raw: PackedStringArray) -> bool:
	return raw.size() >= 1 and raw[0] == _OK


## Polls the operation every frame until its result comes. An empty array when it could not start, did not end within
## `timeout_ms` (`TimeCore` real elapsed time; -1 for no limit), or `release` came first; the last two tell the plugin
## with `cancel`.
func _result_of(plugin: Object, id: int, timeout_ms: int) -> PackedStringArray:
	if id <= 0:
		return PackedStringArray()
	var life: RefCounted = _life
	var deadline: int = TimeCore.get_real_time() + timeout_ms if timeout_ms >= 0 else -1
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null and life == _life and is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		var raw: PackedStringArray = plugin.take_result(id)
		if raw.size() != 0:
			return raw
		if deadline >= 0 and TimeCore.get_real_time() >= deadline:
			break
		await tree.process_frame
	if is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		plugin.cancel(id)
	return PackedStringArray()
