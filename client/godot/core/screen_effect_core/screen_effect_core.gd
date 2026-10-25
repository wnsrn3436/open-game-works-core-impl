class_name ScreenEffectCore
extends RefCounted
## Color overlays that cover the whole visible game area, one per channel, and the fades, flashes and tween presets
## played on them. Camera shake, blur, distortion and shaders that read the screen are not here.

enum ScreenEffectChannel { WORLD, CUTSCENE, TRANSITION }
enum ScreenEffectResult { COMPLETED, CANCELLED, FAILED }

const _TAG: String = "ScreenEffectCore"
const _MAX_DURATION_KEY: String = "TweenCore.maxDurationMs"
const _CHANNEL_COUNT: int = 3
const _CORE_NODE := preload("res://core/screen_effect_core/screen_effect_core_node.gd")

static var _is_initialized: bool = false
static var _node: Node = null
static var _max_duration_ms: int = 0
## Largest opacity a `flash` uses. Changed only by `set_flash_opacity_limit`.
static var _flash_limit: float = 1.0
## Overlay of each channel, indexed by `ScreenEffectChannel`. A white `ColorRect` whose `modulate` is the overlay color
## and opacity, so that the `TweenCore` `Color` and `Opacity` of the overlay are its color and opacity.
static var _overlays: Array[ColorRect] = []
## Current handle of each channel, indexed by `ScreenEffectChannel`. `null` when the channel has no effect.
static var _current: Array[ScreenEffectHandle] = []
static var _tween_options: TweenOptions = null


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	if not CoreSettings.has_int(_MAX_DURATION_KEY):
		LogCore.log_error(_TAG, "init: core settings key TweenCore.maxDurationMs is missing or not an integer")
		return false
	var layers: Array[Node] = []
	for channel: int in _CHANNEL_COUNT:
		var layer: Node = UICore.get_layer(_layer_of(channel))
		if layer == null:
			LogCore.log_error(_TAG, "init: UICore gave no UI layer for channel %d" % channel)
			return false
		layers.append(layer)
	var node: Node = _CORE_NODE.new()
	if not EventCore.subscribe(GameAreaChangedEvent, (node as _CORE_NODE)._on_game_area_changed):
		LogCore.log_error(_TAG, "init: could not subscribe to GameAreaChangedEvent")
		node.free()
		return false
	_max_duration_ms = CoreSettings.get_int(_MAX_DURATION_KEY)
	_overlays.resize(_CHANNEL_COUNT)
	_current.resize(_CHANNEL_COUNT)
	for channel: int in _CHANNEL_COUNT:
		var overlay: ColorRect = ColorRect.new()
		overlay.name = "ScreenEffectOverlay"
		overlay.color = Color.WHITE
		overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
		layers[channel].add_child(overlay)
		_overlays[channel] = overlay
		_reset_overlay(channel)
	_fit_overlays()
	_tween_options = TweenOptions.new()
	_node = node
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: Node = _node
	if is_instance_valid(node):
		(node as _CORE_NODE).released = true
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()
	_clean_up(true)


static func is_initialized() -> bool:
	return _is_initialized


## Puts the overlay of `channel` in `color` and changes its opacity linearly from `start_opacity` to `target_opacity`
## over `duration_ms`, progressing on `time_basis`.
static func fade(
	channel: ScreenEffectChannel, owner: Object, color: Color, start_opacity: float, target_opacity: float,
	duration_ms: int, time_basis: TweenCore.TimeBasis = TweenCore.TimeBasis.REAL_TIME
) -> ScreenEffectHandle:
	if not _check_request("fade", channel, owner, time_basis):
		return _failed_handle()
	if (
		not _check_color("fade", color) or not _check_opacity("fade", start_opacity)
		or not _check_opacity("fade", target_opacity) or not _check_duration("fade", duration_ms)
	):
		return _failed_handle()
	var handle: ScreenEffectHandle = _new_handle(channel, owner)
	var replaced: ScreenEffectHandle = _make_current(channel, handle)
	var overlay: ColorRect = _overlays[channel]
	overlay.modulate = Color(color.r, color.g, color.b, start_opacity)
	overlay.visible = true
	if duration_ms == 0:
		overlay.modulate.a = target_opacity
		_publish_started(channel)
		handle._finish(ScreenEffectResult.COMPLETED)
	else:
		var definition: TweenDefinition = TweenDefinition.new()
		definition.repeat_count = 1
		definition.steps.append(_opacity_step(start_opacity, target_opacity, duration_ms))
		_play(channel, handle, definition, time_basis)
	_end_replaced(replaced)
	return handle


## Puts the overlay of `channel` in `color` and raises its opacity from 0 to the smaller of `max_opacity` and the flash
## opacity limit over `rise_ms`, keeps it for `hold_ms` and lowers it to 0 over `fall_ms`, progressing on `time_basis`.
static func flash(
	channel: ScreenEffectChannel, owner: Object, color: Color, max_opacity: float, rise_ms: int, hold_ms: int,
	fall_ms: int, time_basis: TweenCore.TimeBasis = TweenCore.TimeBasis.REAL_TIME
) -> ScreenEffectHandle:
	if not _check_request("flash", channel, owner, time_basis):
		return _failed_handle()
	if (
		not _check_color("flash", color) or not _check_opacity("flash", max_opacity)
		or not _check_duration("flash", rise_ms) or not _check_duration("flash", hold_ms)
		or not _check_duration("flash", fall_ms)
	):
		return _failed_handle()
	var peak: float = minf(max_opacity, _flash_limit)
	var handle: ScreenEffectHandle = _new_handle(channel, owner)
	var replaced: ScreenEffectHandle = _make_current(channel, handle)
	var overlay: ColorRect = _overlays[channel]
	overlay.modulate = Color(color.r, color.g, color.b, 0.0)
	overlay.visible = true
	if rise_ms == 0 and hold_ms == 0 and fall_ms == 0:
		_publish_started(channel)
		handle._finish(ScreenEffectResult.COMPLETED)
	else:
		var definition: TweenDefinition = TweenDefinition.new()
		definition.repeat_count = 1
		definition.steps.append(_opacity_step(0.0, peak, rise_ms))
		definition.steps.append(_opacity_step(peak, peak, hold_ms))
		definition.steps.append(_opacity_step(peak, 0.0, fall_ms))
		_play(channel, handle, definition, time_basis)
	_end_replaced(replaced)
	return handle


## Plays a loaded tween preset definition that changes only the overlay `Color` and `Opacity` and repeats a finite
## number of times, progressing on `time_basis`. A definition that does not change `Color` plays in the present overlay
## color.
static func play_preset(
	channel: ScreenEffectChannel, owner: Object, definition: TweenDefinition,
	time_basis: TweenCore.TimeBasis = TweenCore.TimeBasis.REAL_TIME
) -> ScreenEffectHandle:
	if not _check_request("play_preset", channel, owner, time_basis):
		return _failed_handle()
	if not _check_preset(definition, _overlays[channel]):
		return _failed_handle()
	var handle: ScreenEffectHandle = _new_handle(channel, owner)
	var replaced: ScreenEffectHandle = _make_current(channel, handle)
	var overlay: ColorRect = _overlays[channel]
	overlay.visible = true
	if _is_instant(definition):
		_apply_end_state(overlay, definition)
		_publish_started(channel)
		handle._finish(ScreenEffectResult.COMPLETED)
	else:
		_play(channel, handle, definition, time_basis)
	_end_replaced(replaced)
	return handle


## Result of the request of `handle`. Waits while it plays; a handle with its result returns it at once. Async.
static func wait_result(handle: ScreenEffectHandle) -> ScreenEffectResult:
	if not _is_initialized:
		LogCore.log_error(_TAG, "wait_result called before init")
		return ScreenEffectResult.FAILED
	if handle == null:
		LogCore.log_error(_TAG, "wait_result: no effect handle")
		return ScreenEffectResult.FAILED
	if not handle._done:
		await handle._waiter.done
	return handle._result


## Puts the end value of the playing request of `handle` on its overlay and ends it with `Completed`.
static func skip_to_end(handle: ScreenEffectHandle) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "skip_to_end called before init")
		return
	if not _holds_overlay(handle) or handle._done:
		return
	TweenCore.skip_to_end(handle._tween)
	handle._finish(ScreenEffectResult.COMPLETED)


## Puts the overlay of `handle` back to no effect when `handle` holds it, ending a playing request with `Cancelled`.
static func clear_handle(handle: ScreenEffectHandle) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "clear_handle called before init")
		return
	if not _holds_overlay(handle):
		return
	_clear_channel(handle._channel)


## `clear_handle` of the handle of every channel whose owner is `owner`.
static func clear_owner(owner: Object) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "clear_owner called before init")
		return
	if not is_instance_valid(owner):
		return
	var owner_id: int = owner.get_instance_id()
	for channel: int in _CHANNEL_COUNT:
		var handle: ScreenEffectHandle = _current[channel]
		if handle != null and handle._owner_id == owner_id:
			_clear_channel(channel)


## Largest opacity of the flashes that start after this call. 0 to 1.
static func set_flash_opacity_limit(limit: float) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_flash_opacity_limit called before init")
		return
	if not _is_unit(limit):
		LogCore.log_error(_TAG, "set_flash_opacity_limit: limit %s is not a finite number from 0 to 1" % limit)
		return
	_flash_limit = limit


## Frame check: clears the channels whose owner was destroyed and ends the requests whose tween ended.
static func _on_frame() -> void:
	if not _is_initialized:
		return
	for channel: int in _CHANNEL_COUNT:
		var handle: ScreenEffectHandle = _current[channel]
		if handle == null:
			continue
		if not is_instance_id_valid(handle._owner_id):
			_clear_channel(channel)
		elif not handle._done and not TweenCore.is_playing(handle._tween):
			handle._finish(ScreenEffectResult.COMPLETED)


## Puts every overlay on the visible game area.
static func _fit_overlays() -> void:
	var area: Rect2 = ResolutionCore.get_visible_game_area()
	for channel: int in _overlays.size():
		if not is_instance_valid(_overlays[channel]):
			continue
		var overlay: ColorRect = _overlays[channel]
		overlay.position = area.position
		overlay.size = area.size


## App exit or tree teardown took the core node out of the tree without `release`.
static func _on_node_exit() -> void:
	if not _is_initialized:
		return
	if is_instance_valid(_node) and EventCore.is_initialized():
		EventCore.unsubscribe_all(_node)
	_clean_up(false)


## `release` and app exit: ends the playing requests with `Cancelled`, destroys the overlays and puts every static var
## back to its initial value. `immediate` frees the overlays now; app exit queues the free.
static func _clean_up(immediate: bool) -> void:
	_is_initialized = false
	var ended: Array[ScreenEffectHandle] = []
	for channel: int in _CHANNEL_COUNT:
		var handle: ScreenEffectHandle = _current[channel]
		_current[channel] = null
		if handle == null or handle._done:
			continue
		if TweenCore.is_initialized():
			TweenCore.stop(handle._tween)
		_reset_overlay(channel)
		ended.append(handle)
	for handle: ScreenEffectHandle in ended:
		handle._finish(ScreenEffectResult.CANCELLED)
	for channel: int in _overlays.size():
		if not is_instance_valid(_overlays[channel]):
			continue
		var overlay: ColorRect = _overlays[channel]
		if immediate:
			overlay.free()
		else:
			overlay.queue_free()
	_reset_state()


static func _reset_state() -> void:
	_is_initialized = false
	_node = null
	_max_duration_ms = 0
	_flash_limit = 1.0
	_overlays = []
	_current = []
	_tween_options = null


static func _layer_of(channel: int) -> UICore.UILayer:
	match channel:
		ScreenEffectChannel.CUTSCENE:
			return UICore.UILayer.CUTSCENE_EFFECT
		ScreenEffectChannel.TRANSITION:
			return UICore.UILayer.TRANSITION_EFFECT
	return UICore.UILayer.WORLD_EFFECT


## A handle that has the result `Failed` and holds no overlay.
static func _failed_handle() -> ScreenEffectHandle:
	var handle: ScreenEffectHandle = ScreenEffectHandle.new()
	handle._finish(ScreenEffectResult.FAILED)
	return handle


static func _new_handle(channel: int, owner: Object) -> ScreenEffectHandle:
	var handle: ScreenEffectHandle = ScreenEffectHandle.new()
	handle._channel = channel
	handle._owner_id = owner.get_instance_id()
	return handle


## Makes `handle` the current handle of `channel` and stops the tween of the handle it replaces. Returns the replaced
## handle, which `_end_replaced` ends once the new request is set up.
static func _make_current(channel: int, handle: ScreenEffectHandle) -> ScreenEffectHandle:
	var replaced: ScreenEffectHandle = _current[channel]
	_current[channel] = handle
	if replaced != null and not replaced._done:
		TweenCore.stop(replaced._tween)
	return replaced


static func _end_replaced(replaced: ScreenEffectHandle) -> void:
	if replaced != null:
		replaced._finish(ScreenEffectResult.CANCELLED)


## Starts the tween of `handle` on the overlay of `channel`, progressing on `time_basis`. When `TweenCore` does not
## start it, `handle` ends with `Failed` and the channel has no effect.
static func _play(
	channel: ScreenEffectChannel, handle: ScreenEffectHandle, definition: TweenDefinition,
	time_basis: TweenCore.TimeBasis
) -> void:
	_tween_options.time_basis = time_basis
	var tween: int = TweenCore.play(definition, _overlays[channel], _tween_options)
	if not TweenCore.is_playing(tween):
		_current[channel] = null
		_reset_overlay(channel)
		handle._finish(ScreenEffectResult.FAILED)
		return
	handle._tween = tween
	_publish_started(channel)


static func _publish_started(channel: ScreenEffectChannel) -> void:
	var event: ScreenEffectStartedEvent = EventCore.acquire(ScreenEffectStartedEvent) as ScreenEffectStartedEvent
	if event == null:
		return
	event.channel = channel
	EventCore.publish(event)


## Stops a playing request of `channel` with `Cancelled` and puts its overlay back to no effect.
static func _clear_channel(channel: int) -> void:
	var handle: ScreenEffectHandle = _current[channel]
	_current[channel] = null
	if handle != null and not handle._done:
		TweenCore.stop(handle._tween)
	_reset_overlay(channel)
	if handle != null:
		handle._finish(ScreenEffectResult.CANCELLED)


## No effect: black, opacity 0, hidden.
static func _reset_overlay(channel: int) -> void:
	if not is_instance_valid(_overlays[channel]):
		return
	var overlay: ColorRect = _overlays[channel]
	overlay.modulate = Color(0.0, 0.0, 0.0, 0.0)
	overlay.visible = false


## True when `handle` is the current handle of its channel.
static func _holds_overlay(handle: ScreenEffectHandle) -> bool:
	if handle == null or handle._channel < 0 or handle._channel >= _CHANNEL_COUNT:
		return false
	return _current[handle._channel] == handle


static func _opacity_step(start: float, target: float, duration_ms: int) -> TweenStep:
	var change: TweenChange = TweenChange.new()
	change.property = TweenCore.TweenProperty.OPACITY
	change.use_start_value = true
	change.start_value = Vector4(start, 0.0, 0.0, 0.0)
	change.target_value = Vector4(target, 0.0, 0.0, 0.0)
	change.duration = duration_ms
	change.delay = 0
	change.easing = TweenCore.Easing.LINEAR
	var step: TweenStep = TweenStep.new()
	step.changes.append(change)
	return step


## True when every change of `definition` has duration 0 and delay 0.
static func _is_instant(definition: TweenDefinition) -> bool:
	for step: TweenStep in definition.steps:
		for change: TweenChange in step.changes:
			if change.duration != 0 or change.delay != 0:
				return false
	return true


## Puts the target values of every change of `definition` on `overlay` in step order.
static func _apply_end_state(overlay: ColorRect, definition: TweenDefinition) -> void:
	for step: TweenStep in definition.steps:
		for change: TweenChange in step.changes:
			var value: Vector4 = change.target_value
			if change.property == TweenCore.TweenProperty.COLOR:
				overlay.modulate = Color(value.x, value.y, value.z, value.w)
			else:
				overlay.modulate.a = value.x


## Channel, time basis and owner check of every request, with the init check.
static func _check_request(operation: String, channel: int, owner: Object, time_basis: int) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "%s called before init" % operation)
		return false
	if channel < 0 or channel >= _CHANNEL_COUNT:
		LogCore.log_error(_TAG, "%s: %d is not a ScreenEffectChannel" % [operation, channel])
		return false
	if time_basis < 0 or time_basis >= TweenCore.TimeBasis.size():
		LogCore.log_error(_TAG, "%s: %d is not a TimeBasis" % [operation, time_basis])
		return false
	if not is_instance_valid(owner):
		LogCore.log_error(_TAG, "%s: the owner object is missing or destroyed" % operation)
		return false
	return true


static func _check_color(operation: String, color: Color) -> bool:
	if _is_unit(color.r) and _is_unit(color.g) and _is_unit(color.b):
		return true
	LogCore.log_error(_TAG, "%s: color %s has a component that is not a finite number from 0 to 1" % [operation, color])
	return false


static func _check_opacity(operation: String, opacity: float) -> bool:
	if _is_unit(opacity):
		return true
	LogCore.log_error(_TAG, "%s: opacity %s is not a finite number from 0 to 1" % [operation, opacity])
	return false


static func _check_duration(operation: String, duration_ms: int) -> bool:
	if duration_ms >= 0 and duration_ms <= _max_duration_ms:
		return true
	LogCore.log_error(
		_TAG, "%s: duration %d ms is below 0 or above TweenCore.maxDurationMs %d" % [operation, duration_ms, _max_duration_ms]
	)
	return false


## A preset definition changes only `Color` and `Opacity`, repeats a finite number of times and passes
## `TweenCore.check_definition` on the overlay.
static func _check_preset(definition: TweenDefinition, overlay: ColorRect) -> bool:
	if definition == null:
		LogCore.log_error(_TAG, "play_preset: no tween definition")
		return false
	for step: TweenStep in definition.steps:
		if step == null:
			LogCore.log_error(_TAG, "play_preset: the definition has an empty step")
			return false
		for change: TweenChange in step.changes:
			if change == null:
				LogCore.log_error(_TAG, "play_preset: the definition has an empty change")
				return false
			if change.property != TweenCore.TweenProperty.COLOR and change.property != TweenCore.TweenProperty.OPACITY:
				LogCore.log_error(_TAG, "play_preset: the definition changes a property other than Color and Opacity")
				return false
	if definition.repeat_count == 0:
		LogCore.log_error(_TAG, "play_preset: the definition repeats forever")
		return false
	if not TweenCore.check_definition(definition, overlay):
		LogCore.log_error(_TAG, "play_preset: the definition fails the TweenCore definition check")
		return false
	return true


## A finite number from 0 to 1.
static func _is_unit(value: float) -> bool:
	return is_finite(value) and value >= 0.0 and value <= 1.0
