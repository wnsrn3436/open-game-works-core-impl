class_name TimeCoreDev
extends RefCounted
## DEV operations of `TimeCore`: the test clock, test frames and step mode.

const _TAG: String = "TimeCore"


## TimeCore reads the monotonic time and the device time from `clock` instead of the device. Only before `init`;
## `TimeCore.release` clears it.
static func set_test_clock(clock: DevTestClock) -> void:
	if TimeCore._is_initialized:
		LogCore.log_error(_TAG, "set_test_clock: after init; ignored")
		return
	if clock == null:
		TimeCore._test_clock = null
		TimeCore._test_monotonic_ms = Callable()
		TimeCore._test_device_time_ms = Callable()
		return
	TimeCore._test_clock = clock
	TimeCore._test_monotonic_ms = _clock_monotonic_ms
	TimeCore._test_device_time_ms = _clock_device_time_ms


## While TimeCore reads a test clock, each read of its monotonic time moves the test clock's monotonic time by `ms`
## after the read. 0 stops it. `TimeCore.release` makes it 0.
static func set_test_clock_read_step(ms: int) -> void:
	if not TimeCore._is_initialized:
		LogCore.log_error(_TAG, "set_test_clock_read_step: not initialized")
		return
	if ms < 0:
		LogCore.log_error(_TAG, "set_test_clock_read_step: negative ms; ignored")
		return
	TimeCore._test_clock_read_step_ms = ms


## Readers of the test clock that `TimeCore` calls. Static functions, not lambdas: a lambda of this script still in a
## TimeCore static var at engine exit can be the last reference to this script, and freeing it then aborts the engine.
static func _clock_monotonic_ms() -> int:
	var clock: DevTestClock = TimeCore._test_clock as DevTestClock
	if clock == null:
		return 0
	var now: int = clock.monotonic_ms
	clock.monotonic_ms += TimeCore._test_clock_read_step_ms
	return now


static func _clock_device_time_ms() -> int:
	var clock: DevTestClock = TimeCore._test_clock as DevTestClock
	if clock == null:
		return 0
	return clock.device_time_ms


## Called after the test clock moved by `ms`. Without `background` one frame of `ms` real increment and its day
## check; with `background` the background entry and return, with background elapsed `ms` and a monotonic difference of
## 0 when `asleep`, else `ms`.
static func step_test_frame(ms: int, background: bool, asleep: bool) -> void:
	if not TimeCore._is_initialized:
		LogCore.log_error(_TAG, "step_test_frame: not initialized")
		return
	if ms < 0:
		LogCore.log_error(_TAG, "step_test_frame: negative ms; ignored")
		return
	if background:
		TimeCore._step_test_background(ms, 0 if asleep else ms)
	else:
		TimeCore._step_test_frame(ms)


## Turns step mode on or off. The step budget becomes 0 either way, so the engine features stop when it turns on and
## follow `TimeCore.set_paused` when it turns off.
static func set_step_mode(on: bool) -> void:
	if not TimeCore._is_initialized:
		LogCore.log_error(_TAG, "set_step_mode: not initialized")
		return
	TimeCore._step_mode = on
	TimeCore._step_budget_ms = 0
	TimeCore._apply_engine_pause()


static func is_step_mode() -> bool:
	if not TimeCore._is_initialized:
		LogCore.log_error(_TAG, "is_step_mode: not initialized")
		return false
	return TimeCore._step_mode


## Adds `ms` to the step budget, so the engine features run unless `TimeCore.set_paused` pauses. Ignored outside step
## mode and for `ms` below 1.
static func add_step_budget(ms: int) -> void:
	if not TimeCore._is_initialized:
		LogCore.log_error(_TAG, "add_step_budget: not initialized")
		return
	if not TimeCore._step_mode:
		LogCore.log_error(_TAG, "add_step_budget: not in step mode; ignored")
		return
	if ms < 1:
		LogCore.log_error(_TAG, "add_step_budget: ms is below 1; ignored")
		return
	TimeCore._step_budget_ms += ms
	TimeCore._apply_engine_pause()


## Step budget left. ms.
static func get_step_budget() -> int:
	if not TimeCore._is_initialized:
		LogCore.log_error(_TAG, "get_step_budget: not initialized")
		return 0
	return TimeCore._step_budget_ms
