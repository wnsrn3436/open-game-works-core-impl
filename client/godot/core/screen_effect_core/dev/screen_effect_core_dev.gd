class_name ScreenEffectCoreDev
extends RefCounted
## DEV operations of `ScreenEffectCore`.

const _TAG: String = "ScreenEffectCore"


## Rectangle, color, opacity and visibility of the overlay of `channel`. An empty rectangle, black, opacity 0 and
## hidden when it cannot be read.
static func get_overlay_state(channel: ScreenEffectCore.ScreenEffectChannel) -> GetOverlayStateResult:
	var state: GetOverlayStateResult = GetOverlayStateResult.new()
	if not ScreenEffectCore._is_initialized:
		LogCore.log_error(_TAG, "get_overlay_state called before init")
		return state
	if channel < 0 or channel >= ScreenEffectCore._CHANNEL_COUNT:
		LogCore.log_error(_TAG, "get_overlay_state: %d is not a ScreenEffectChannel" % channel)
		return state
	if not is_instance_valid(ScreenEffectCore._overlays[channel]):
		LogCore.log_error(_TAG, "get_overlay_state: the overlay of channel %d was destroyed" % channel)
		return state
	var overlay: ColorRect = ScreenEffectCore._overlays[channel]
	state.rect = overlay.get_rect()
	state.color = Color(overlay.modulate.r, overlay.modulate.g, overlay.modulate.b)
	state.opacity = overlay.modulate.a
	state.visible = overlay.visible
	return state


## World skip on or off. While it is on, a `World` `fade`, `flash` or `play_preset` that passes its input check returns a
## `Completed` handle without replacing the current `World` handle, changing the overlay, starting a tween or sending
## `ScreenEffectStartedEvent`. A `World` effect that plays when it turns on goes on. Other channels are not skipped.
static func set_world_skip(skipped: bool) -> void:
	if not ScreenEffectCore._is_initialized:
		LogCore.log_error(_TAG, "set_world_skip called before init")
		return
	ScreenEffectCore._world_skip = skipped
