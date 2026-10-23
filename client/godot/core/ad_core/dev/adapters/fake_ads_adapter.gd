class_name FakeAdsAdapter
extends AdsAdapter
## Fake ads adapter of every platform. Its unit ID is the decimal placement ID value. `present` covers the screen with
## an opaque single-color rectangle for `AdCore.fakePresentMs`, and a completed rewarded `present` first sends the core
## cheat `FakeAdCallback` that server `ads-reward` handles in place of the ad network callback. `AdCoreDev` sets the
## results and the failures.

const _OVERLAY_LAYER: int = 128
const _OVERLAY_COLOR: Color = Color(0.1, 0.1, 0.1, 1.0)

var _overlay: CanvasLayer = null
## `release` came: a `present` in progress ends.
var _released: bool = false


func _unit_id(placement_id: int, _listed: String) -> String:
	return str(placement_id)


func request_ad_consent() -> ConsentResult:
	var result: ConsentResult = ConsentResult.new()
	if _fails("request_ad_consent"):
		return result
	result.ok = true
	result.required = AdCore._fake_consent_required
	result.personalized = AdCore._fake_consent_personalized
	return result


func is_privacy_options_required() -> bool:
	return AdCore._fake_privacy_required and not _fails("is_privacy_options_required")


func show_privacy_options() -> bool:
	return not _fails("show_privacy_options")


func initialize(_consent: AdConsent) -> bool:
	return not _fails("initialize")


func load_ad(ad_type: GameData.AdType, _unit_id_value: String, _consent: AdConsent) -> bool:
	if ad_type == GameData.AdType.REWARDED and not AdCore._fake_delayed_notify_id.is_empty():
		var notify_id: String = AdCore._fake_delayed_notify_id
		AdCore._fake_delayed_notify_id = ""
		await _send_callback(notify_id)
	return not _fails("load")


func present(ad_type: GameData.AdType, _unit_id_value: String, verification: Verification) -> AdCore.AdShowResult:
	var result: AdCore.AdShowResult = AdCore.AdShowResult.COMPLETED
	if AdCore._fake_next_present >= 0:
		result = AdCore._fake_next_present as AdCore.AdShowResult
		AdCore._fake_next_present = -1
	if _fails("present") or result == AdCore.AdShowResult.FAILED:
		return AdCore.AdShowResult.FAILED
	_released = false
	if not await _cover_screen():
		return AdCore.AdShowResult.FAILED
	if result == AdCore.AdShowResult.ABORTED:
		return AdCore.AdShowResult.ABORTED
	if ad_type == GameData.AdType.REWARDED and verification != null:
		if AdCore._fake_skip_callback:
			AdCore._fake_skip_callback = false
		elif AdCore._fake_delay_callback:
			AdCore._fake_delay_callback = false
			AdCore._fake_delayed_notify_id = verification.notify_id
		else:
			await _send_callback(verification.notify_id)
	return AdCore.AdShowResult.COMPLETED


func open_banner(_unit_id_value: String, _consent: AdConsent) -> bool:
	return not _fails("open_banner")


func close_banner() -> void:
	pass


func release() -> void:
	_released = true
	_remove_overlay()


static func _fails(operation: String) -> bool:
	return AdCore._fake_fails.has(operation) and AdCore._fake_fails[operation]


static func _send_callback(notify_id: String) -> void:
	var request: CoreCheatContract.FakeAdCallbackRequest = CoreCheatContract.FakeAdCallbackRequest.new()
	request.notify_id = notify_id
	await NetworkCoreDev.send_cheat(request)


## Covers the screen for `AdCore.fakePresentMs` of real elapsed time. False when `release` came first.
func _cover_screen() -> bool:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		return false
	var layer: CanvasLayer = CanvasLayer.new()
	layer.name = "FakeAd"
	layer.layer = _OVERLAY_LAYER
	var rect: ColorRect = ColorRect.new()
	rect.color = _OVERLAY_COLOR
	rect.mouse_filter = Control.MOUSE_FILTER_STOP
	rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(rect)
	tree.root.add_child(layer)
	_overlay = layer
	var started_at: int = TimeCore.get_real_time()
	while not _released and TimeCore.get_real_time() - started_at < AdCore._fake_present_ms:
		await tree.process_frame
	_remove_overlay()
	return not _released


func _remove_overlay() -> void:
	if _overlay != null and is_instance_valid(_overlay):
		if _overlay.get_parent() != null:
			_overlay.get_parent().remove_child(_overlay)
		_overlay.queue_free()
	_overlay = null
