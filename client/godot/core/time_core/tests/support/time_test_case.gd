extends UnitTestCase
## Base of the TimeCore core tests: test settings, the module setup, syncs and the event recorder.

const TAG: String = "TimeCore"
const ERROR: String = "error"
const DAY_MS: int = 86400000
const MARGIN_MS: int = 500
const JUMP_THRESHOLD_MS: int = 60000
## A server time far from any game day boundary of the offsets the tests use.
const SERVER_TIME: int = 1710000000000
const _RECORDER := preload("res://core/time_core/tests/support/time_event_recorder.gd")

var recorder: _RECORDER = null


func before_each() -> void:
	super()
	set_int("TimeCore.reachMarginMs", MARGIN_MS)
	set_int("TimeCore.jumpThresholdMs", JUMP_THRESHOLD_MS)
	set_int("dailyResetOffsetMs", 0)


func after_each() -> void:
	super()
	TimeCore.release()
	EventCore.release()
	LogCore.release()


func set_int(key: String, value: int) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


## Inits TimeCore and the modules it depends on, in module list order.
func init_modules() -> void:
	assert_true(LogCore.init())
	assert_true(EventCore.init())
	assert_true(TimeCore.init())


## Inits the modules and subscribes a new event recorder to the TimeCore events.
func init_with_recorder() -> void:
	init_modules()
	recorder = _RECORDER.new()
	add_child_autofree(recorder)
	assert_true(recorder.subscribe())


## Syncs with a response received now whose round trip is 0, so the server time becomes `server_time`.
func sync_to(server_time: int) -> void:
	var now: int = TimeCore.get_monotonic_time()
	TimeCore.sync_server_time(server_time, now, now)


## Moves the test clock by `ms` of foreground time: one test frame.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)


## Start of a game day boundary of offset `offset_ms`, far from 1970.
func boundary(offset_ms: int) -> int:
	return 19800 * DAY_MS + offset_ms


## Releases TimeCore and inits it again with game settings `dailyResetOffsetMs` `offset_ms`. The test clock is gone
## after `release`; the day calculations do not read it.
func reinit_with_offset(offset_ms: int) -> void:
	TimeCore.release()
	set_int("dailyResetOffsetMs", offset_ms)
	assert_true(TimeCore.init())
