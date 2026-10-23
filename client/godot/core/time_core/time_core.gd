class_name TimeCore
extends RefCounted
## Estimates the server time, tells reach, game day and reset cycle boundaries, and keeps the game time with its time
## scale and pause and the background entry and return of the app. Time judgments use the server time only.

const _TAG: String = "TimeCore"
const _REACH_MARGIN_KEY: String = "TimeCore.reachMarginMs"
const _JUMP_THRESHOLD_KEY: String = "TimeCore.jumpThresholdMs"
const _DAILY_RESET_OFFSET_KEY: String = "dailyResetOffsetMs"
const _SETTINGS_KEYS: PackedStringArray = [_REACH_MARGIN_KEY, _JUMP_THRESHOLD_KEY, _DAILY_RESET_OFFSET_KEY]
const _CORE_NODE := preload("res://core/time_core/time_core_node.gd")
## 1 day in ms.
const _DAY_MS: int = 86400000
const _DEFAULT_TIME_SCALE: int = 1000
## The core node processes before the other nodes, so every frame code of a frame reads the time of that frame.
const _PROCESS_PRIORITY: int = -1000000

static var _is_initialized: bool = false
## Replaced by every `init`; work that sees another session after an event delivery stops.
static var _session: RefCounted = null
static var _node: Node = null

# Settings read in `init`.
static var _reach_margin_ms: int = 0
static var _jump_threshold_ms: int = 0
## Game day offset o. 0 when the game settings value is out of range.
static var _offset_ms: int = 0

# Sync.
static var _synced: bool = false
## Base server time and base monotonic time: server time = base server + monotonic now − base monotonic.
static var _base_server_ms: int = 0
static var _base_monotonic_ms: int = 0
## `get_current_day` value of the last day check.
static var _recorded_day: int = 0

# Game time and real elapsed time.
static var _game_time_ms: int = 0
static var _real_time_ms: int = 0
static var _game_frame_ms: int = 0
static var _real_frame_ms: int = 0
## Remainder of the permille division, carried to the next frame. 0 to 999.
static var _carry: int = 0
static var _time_scale: int = _DEFAULT_TIME_SCALE
static var _paused: bool = false
## Monotonic time of the last engine frame, without the test clock.
static var _last_frame_monotonic_ms: int = 0

# Background.
static var _in_background: bool = false
static var _background_monotonic_ms: int = 0
static var _background_device_ms: int = 0
static var _resume_count: int = 0
static var _last_background_ms: int = 0

## DEV: `set_test_clock`. The test clock, and the static functions of `TimeCoreDev` that read its monotonic time and
## device time.
static var _test_clock: RefCounted = null
static var _test_monotonic_ms: Callable = Callable()
static var _test_device_time_ms: Callable = Callable()
## DEV: `set_test_clock_read_step`. ms the test clock's monotonic time moves after each read of it.
static var _test_clock_read_step_ms: int = 0
## DEV: increments of the test frames processed after the last engine frame.
static var _pending_real_ms: int = 0
static var _pending_game_ms: int = 0
## DEV: step mode and its budget.
static var _step_mode: bool = false
static var _step_budget_ms: int = 0


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	for key: String in _SETTINGS_KEYS:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init: settings key %s is missing or not an integer" % key)
			return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init: no scene tree")
		return false
	_reach_margin_ms = CoreSettings.get_int(_REACH_MARGIN_KEY)
	_jump_threshold_ms = CoreSettings.get_int(_JUMP_THRESHOLD_KEY)
	_offset_ms = CoreSettings.get_int(_DAILY_RESET_OFFSET_KEY)
	if _offset_ms <= -_DAY_MS or _offset_ms >= _DAY_MS:
		LogCore.log_error(_TAG, "init: game settings dailyResetOffsetMs %d is not between -1 day and 1 day; 0 is used" % _offset_ms)
		_offset_ms = 0
	_session = RefCounted.new()
	_last_frame_monotonic_ms = _monotonic_now()
	Engine.time_scale = 1.0
	tree.paused = false
	var node: Node = _CORE_NODE.new()
	node.name = _TAG
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	node.process_priority = _PROCESS_PRIORITY
	_node = node
	_is_initialized = true
	tree.root.add_child(node)
	return true


static func release() -> void:
	var node: Node = _node
	_node = null
	_reset()
	if node != null and is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Sync from a response: `server_time_at` of the response, the monotonic time the request went to the transport and
## the monotonic time the transport told the response.
static func sync_server_time(server_time_at: int, sent_monotonic_ms: int, received_monotonic_ms: int) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "sync_server_time: not initialized")
		return
	if received_monotonic_ms < sent_monotonic_ms:
		LogCore.log_error(_TAG, "sync_server_time: received monotonic time is before sent monotonic time; ignored")
		return
	if server_time_at <= 0:
		LogCore.log_error(_TAG, "sync_server_time: server_time_at is not positive; ignored")
		return
	var now: int = _monotonic_now()
	var was_synced: bool = _synced
	var previous: int = _server_time_at(now)
	_base_server_ms = server_time_at + UtilCore.floor_div(received_monotonic_ms - sent_monotonic_ms, 2)
	_base_monotonic_ms = received_monotonic_ms
	_synced = true
	var current: int = _server_time_at(now)
	if not was_synced:
		_recorded_day = _current_day_value()
		return
	if absi(current - previous) >= _jump_threshold_ms:
		var session: RefCounted = _session
		var event := EventCore.acquire(ServerTimeJumpedEvent) as ServerTimeJumpedEvent
		if event != null:
			event.previous_server_time = previous
			event.server_time = current
			EventCore.publish(event)
		if session != _session:
			return
	_check_day()


static func is_synced() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_synced: not initialized")
		return false
	return _synced


## Server time, Unix ms.
static func get_server_time() -> int:
	if not _can_read_server_time("get_server_time"):
		return 0
	return _server_time_at(_monotonic_now())


## Device time, Unix ms. The user can change it; do not judge time with it.
static func get_device_time() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_device_time: not initialized")
		return 0
	return _device_now()


## Monotonic time, ms. Does not go down while the app runs and does not follow device time changes.
static func get_monotonic_time() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_monotonic_time: not initialized")
		return 0
	return _monotonic_now()


## Whether server time ≥ target + `TimeCore.reachMarginMs`. The margin moves the server time, not the target, so a
## target near the int64 maximum does not wrap.
static func is_reached(target: int) -> bool:
	if not _can_read_server_time("is_reached"):
		return false
	return _server_time_at(_monotonic_now()) - _reach_margin_ms >= target


## Whether server time < end − `TimeCore.reachMarginMs`. The margin moves the server time, not the end, so an end
## near the int64 minimum does not wrap.
static func is_before_end(end: int) -> bool:
	if not _can_read_server_time("is_before_end"):
		return false
	return _server_time_at(_monotonic_now()) + _reach_margin_ms < end


## target + `TimeCore.reachMarginMs` − server time, at least 0. For display and local push delays only. Computed as
## target − (server time − margin) only when the target is not reached, so the difference is positive and does not wrap.
static func get_remaining_ms(target: int) -> int:
	if not _can_read_server_time("get_remaining_ms"):
		return 0
	var reach_time: int = _server_time_at(_monotonic_now()) - _reach_margin_ms
	if reach_time >= target:
		return 0
	return target - reach_time


## Start of the game day that holds `time`.
static func get_day_start(time: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_day_start: not initialized")
		return 0
	return _day_start(time)


## Start of the game day after the one that holds `time`.
static func get_next_day_boundary(time: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_next_day_boundary: not initialized")
		return 0
	return _day_start(time) + _DAY_MS


## Whether `a` and `b` are in the same game day.
static func is_same_day(a: int, b: int) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_same_day: not initialized")
		return false
	return _day_number(a) == _day_number(b)


## Start of the current game day: `get_day_start`(server time − `TimeCore.reachMarginMs`).
static func get_current_day() -> int:
	if not _can_read_server_time("get_current_day"):
		return 0
	return _current_day_value()


## Game day number of `time`, the same as server `server-time`.
static func get_day_number(time: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_day_number: not initialized")
		return 0
	return _day_number(time)


## Start of the reset cycle that holds `time`. 0 for `NONE`.
static func get_period_start(cycle: GameData.ResetCycle, time: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_period_start: not initialized")
		return 0
	if not _is_cycle(cycle):
		LogCore.log_error(_TAG, "get_period_start: %d is not a ResetCycle element" % cycle)
		return 0
	return _period_start(cycle, time)


## First reset time after `time`: the start of the next reset cycle. 0 for `NONE`.
static func get_next_reset(cycle: GameData.ResetCycle, time: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_next_reset: not initialized")
		return 0
	if not _is_cycle(cycle):
		LogCore.log_error(_TAG, "get_next_reset: %d is not a ResetCycle element" % cycle)
		return 0
	if cycle == GameData.ResetCycle.NONE:
		return 0
	var day: int = _day_number(time)
	match cycle:
		GameData.ResetCycle.DAILY:
			return (day + 1) * _DAY_MS + _offset_ms
		GameData.ResetCycle.WEEKLY:
			return (_week_first_day(day) + 7) * _DAY_MS + _offset_ms
		_:
			return _month_first_day(day, true) * _DAY_MS + _offset_ms


## Game time, ms: elapsed time with the time scale and pause.
static func get_game_time() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_game_time: not initialized")
		return 0
	return _game_time_ms


## Game time increment of this frame.
static func get_game_frame_ms() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_game_frame_ms: not initialized")
		return 0
	return _game_frame_ms


## Real elapsed time, ms: elapsed time without the time scale and pause.
static func get_real_time() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_real_time: not initialized")
		return 0
	return _real_time_ms


## Real elapsed time increment of this frame.
static func get_real_frame_ms() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_real_frame_ms: not initialized")
		return 0
	return _real_frame_ms


## Time scale in permille. 0 or less is ignored.
static func set_time_scale(permille: int) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_time_scale: not initialized")
		return
	if permille <= 0:
		LogCore.log_error(_TAG, "set_time_scale: time scale is not positive; ignored")
		return
	_time_scale = permille
	Engine.time_scale = float(permille) / 1000.0


static func get_time_scale() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_time_scale: not initialized")
		return _DEFAULT_TIME_SCALE
	return _time_scale


static func set_paused(paused: bool) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_paused: not initialized")
		return
	_paused = paused
	_apply_engine_pause()


static func is_paused() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_paused: not initialized")
		return false
	return _paused


## Background returns after `init`.
static func get_resume_count() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_resume_count: not initialized")
		return 0
	return _resume_count


## Background elapsed time of the last return. 0 when there was no return.
static func get_last_background_ms() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_last_background_ms: not initialized")
		return 0
	return _last_background_ms


# Internal: core node and DEV code.

## Frame code. One engine frame: the real and game increments, then the day check. With the test clock the engine
## frame increment is the sum of the test frames processed after the last engine frame.
static func _on_engine_frame() -> void:
	if not _is_initialized:
		return
	if _test_monotonic_ms.is_valid():
		_real_frame_ms = _pending_real_ms
		_game_frame_ms = _pending_game_ms
		_pending_real_ms = 0
		_pending_game_ms = 0
	else:
		var now: int = Time.get_ticks_msec()
		var real_increment: int = maxi(now - _last_frame_monotonic_ms, 0)
		_last_frame_monotonic_ms = now
		var game_increment: int = _game_increment(real_increment)
		_real_frame_ms = real_increment
		_game_frame_ms = game_increment
		_real_time_ms += real_increment
		_game_time_ms += game_increment
	_check_day()


## The engine told the background entry.
static func _on_engine_background() -> void:
	if not _is_initialized or _in_background:
		return
	_background_monotonic_ms = _monotonic_now()
	_background_device_ms = _device_now()
	_enter_background()


## The engine told the background return.
static func _on_engine_foreground() -> void:
	if not _is_initialized or not _in_background:
		return
	var monotonic_diff: int = _monotonic_now() - _background_monotonic_ms
	var device_diff: int = _device_now() - _background_device_ms
	_return_from_background(maxi(monotonic_diff, device_diff), monotonic_diff)


## The core node left the tree outside `release`: app exit or tree teardown. Cleans up as `release` does.
static func _on_node_exit(node: Node) -> void:
	if node != _node:
		return
	_node = null
	_reset()


## DEV: one test frame of `ms` real increment and its day check. Its frame increments are its own; the next engine
## frame reports the sum of the test frames processed after the last engine frame.
static func _step_test_frame(ms: int) -> void:
	var game_increment: int = _game_increment(ms)
	_real_time_ms += ms
	_game_time_ms += game_increment
	_pending_real_ms += ms
	_pending_game_ms += game_increment
	_real_frame_ms = ms
	_game_frame_ms = game_increment
	_check_day()


## DEV: background entry and return of a test background step.
static func _step_test_background(elapsed_ms: int, monotonic_diff_ms: int) -> void:
	if _in_background:
		return
	var session: RefCounted = _session
	_enter_background()
	if session != _session:
		return
	_return_from_background(elapsed_ms, monotonic_diff_ms)


static func _enter_background() -> void:
	_in_background = true
	var session: RefCounted = _session
	LogCore.notify_app_state(LogCore.AppState.BACKGROUND)
	if session != _session:
		return
	var event := EventCore.acquire(AppBackgroundEnteredEvent) as AppBackgroundEnteredEvent
	if event != null:
		EventCore.publish(event)


static func _return_from_background(elapsed_ms: int, monotonic_diff_ms: int) -> void:
	_in_background = false
	_resume_count += 1
	_last_background_ms = elapsed_ms
	if _synced:
		_base_server_ms += elapsed_ms - monotonic_diff_ms
	_last_frame_monotonic_ms = _monotonic_now()
	var session: RefCounted = _session
	LogCore.notify_app_state(LogCore.AppState.FOREGROUND)
	if session != _session:
		return
	var event := EventCore.acquire(AppForegroundReturnedEvent) as AppForegroundReturnedEvent
	if event != null:
		event.background_ms = elapsed_ms
		event.resume_count = _resume_count
		EventCore.publish(event)


## Game time increment of a frame with `real_increment` ms: time scale with carry, pause, then the step budget.
static func _game_increment(real_increment: int) -> int:
	if _paused:
		return 0
	var scaled: int = real_increment * _time_scale + _carry
	var increment: int = UtilCore.floor_div(scaled, 1000)
	_carry = scaled - increment * 1000
	if _step_mode:
		increment = mini(increment, _step_budget_ms)
		_step_budget_ms -= increment
		if increment > 0 and _step_budget_ms == 0:
			_apply_engine_pause_after_frame.call_deferred(_session)
	return increment


## Engine features stop while `set_paused` pauses, and in step mode while the step budget is 0. `_paused`, and so
## `is_paused`, stays the `set_paused` value.
static func _apply_engine_pause() -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree != null:
		tree.paused = _paused or (_step_mode and _step_budget_ms == 0)


## Deferred from the frame in which the step budget reached 0: the engine features of that frame run to its end and
## stop after it. Does nothing for another session.
static func _apply_engine_pause_after_frame(session: RefCounted) -> void:
	if session != _session:
		return
	_apply_engine_pause()


## Frame code. Publishes `DayChangedEvent` when the current game day differs from the recorded one.
static func _check_day() -> void:
	if not _synced:
		return
	var day: int = _current_day_value()
	if day == _recorded_day:
		return
	_recorded_day = day
	var event := EventCore.acquire(DayChangedEvent) as DayChangedEvent
	if event != null:
		event.day_start = day
		EventCore.publish(event)


static func _can_read_server_time(operation: String) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "%s: not initialized" % operation)
		return false
	if not _synced:
		LogCore.log_error(_TAG, "%s: before the first sync" % operation)
		return false
	return true


static func _server_time_at(monotonic_ms: int) -> int:
	return _base_server_ms + monotonic_ms - _base_monotonic_ms


static func _current_day_value() -> int:
	return _day_start(_server_time_at(_monotonic_now()) - _reach_margin_ms)


static func _monotonic_now() -> int:
	if _test_monotonic_ms.is_valid():
		var test_time: int = _test_monotonic_ms.call()
		return test_time
	return Time.get_ticks_msec()


static func _device_now() -> int:
	if _test_device_time_ms.is_valid():
		var test_time: int = _test_device_time_ms.call()
		return test_time
	return int(floorf(Time.get_unix_time_from_system() * 1000.0))


static func _day_number(time: int) -> int:
	return UtilCore.floor_div(time - _offset_ms, _DAY_MS)


static func _day_start(time: int) -> int:
	return time - UtilCore.floor_mod(time - _offset_ms, _DAY_MS)


static func _is_cycle(cycle: int) -> bool:
	return (
		cycle == GameData.ResetCycle.NONE
		or cycle == GameData.ResetCycle.DAILY
		or cycle == GameData.ResetCycle.WEEKLY
		or cycle == GameData.ResetCycle.MONTHLY
	)


static func _period_start(cycle: GameData.ResetCycle, time: int) -> int:
	if cycle == GameData.ResetCycle.NONE:
		return 0
	var day: int = _day_number(time)
	match cycle:
		GameData.ResetCycle.DAILY:
			return day * _DAY_MS + _offset_ms
		GameData.ResetCycle.WEEKLY:
			return _week_first_day(day) * _DAY_MS + _offset_ms
		_:
			return _month_first_day(day, false) * _DAY_MS + _offset_ms


## First game day of the week of game day `day`. Weeks start on the game day whose date is a Monday; game day 0
## (1970-01-01) is a Thursday.
static func _week_first_day(day: int) -> int:
	return UtilCore.floor_div(day + 3, 7) * 7 - 3


## First game day of the month of game day `day`, or of the next month when `next` is true. The date of game day d is
## the UTC date of Unix ms d × 1 day.
static func _month_first_day(day: int, next: bool) -> int:
	# Civil date from days since 1970-01-01, with March as the first month of the computing year.
	var z: int = day + 719468
	var era: int = UtilCore.floor_div(z, 146097)
	var day_of_era: int = z - era * 146097
	var year_of_era: int = UtilCore.floor_div(
		day_of_era - UtilCore.floor_div(day_of_era, 1460) + UtilCore.floor_div(day_of_era, 36524)
		- UtilCore.floor_div(day_of_era, 146096),
		365
	)
	var day_of_year: int = day_of_era - (
		365 * year_of_era + UtilCore.floor_div(year_of_era, 4) - UtilCore.floor_div(year_of_era, 100)
	)
	var shifted_month: int = UtilCore.floor_div(5 * day_of_year + 2, 153)
	var month: int = shifted_month + 3 if shifted_month < 10 else shifted_month - 9
	var year: int = year_of_era + era * 400 + (1 if month <= 2 else 0)
	if next:
		month += 1
		if month > 12:
			month = 1
			year += 1
	return _days_from_civil(year, month, 1)


## Days since 1970-01-01 of the civil date `year`-`month`-`day_of_month`.
static func _days_from_civil(year: int, month: int, day_of_month: int) -> int:
	var computing_year: int = year - (1 if month <= 2 else 0)
	var era: int = UtilCore.floor_div(computing_year, 400)
	var year_of_era: int = computing_year - era * 400
	var shifted_month: int = month - 3 if month > 2 else month + 9
	var day_of_year: int = UtilCore.floor_div(153 * shifted_month + 2, 5) + day_of_month - 1
	var day_of_era: int = (
		year_of_era * 365 + UtilCore.floor_div(year_of_era, 4) - UtilCore.floor_div(year_of_era, 100) + day_of_year
	)
	return era * 146097 + day_of_era - 719468


## Back to the state before `init`. The engine time scale and pause go back to their defaults.
static func _reset() -> void:
	var was_initialized: bool = _is_initialized
	_is_initialized = false
	_session = null
	_reach_margin_ms = 0
	_jump_threshold_ms = 0
	_offset_ms = 0
	_synced = false
	_base_server_ms = 0
	_base_monotonic_ms = 0
	_recorded_day = 0
	_game_time_ms = 0
	_real_time_ms = 0
	_game_frame_ms = 0
	_real_frame_ms = 0
	_carry = 0
	_time_scale = _DEFAULT_TIME_SCALE
	_paused = false
	_last_frame_monotonic_ms = 0
	_in_background = false
	_background_monotonic_ms = 0
	_background_device_ms = 0
	_resume_count = 0
	_last_background_ms = 0
	_test_clock = null
	_test_monotonic_ms = Callable()
	_test_device_time_ms = Callable()
	_test_clock_read_step_ms = 0
	_pending_real_ms = 0
	_pending_game_ms = 0
	_step_mode = false
	_step_budget_ms = 0
	if was_initialized:
		Engine.time_scale = 1.0
		var tree: SceneTree = Engine.get_main_loop() as SceneTree
		if tree != null:
			tree.paused = false
