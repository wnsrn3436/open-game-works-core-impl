extends UnitTestCase
## Base of the InputBlockCore core tests: the test value of `InputBlockCore.maxDurationMs` and the module setup.

const TAG: String = "InputBlockCore"
const MAX_MS: int = 1000


func before_each() -> void:
	super()
	assert_true(UnitTestCore.set_test_settings("InputBlockCore.maxDurationMs", MAX_MS))


func after_each() -> void:
	super()
	InputBlockCore.release()
	ResolutionCore.release()
	ResourceCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()


## Inits InputBlockCore and the modules it depends on, in module list order.
func init_modules() -> void:
	assert_true(LogCore.init())
	assert_true(EventCore.init())
	assert_true(TimeCore.init())
	assert_true(InputBlockCore.init())


## Inits InputBlockCore after `ResolutionCore` and the modules it depends on, in module list order, and sets a
## `Letterbox` test screen of `base` resolution and `window` size.
func init_modules_with_test_screen(base: Vector2i, window: Vector2i) -> void:
	assert_true(LogCore.init())
	assert_true(EventCore.init())
	assert_true(TimeCore.init())
	assert_true(LocalDataCore.init())
	assert_true(LocalDataCore.load_device_file())
	ResourceCoreDev.set_test_key_list({})
	assert_true(ResourceCore.init())
	assert_true(ResolutionCore.init())
	ResolutionCoreDev.set_test_screen(base, window, ResolutionCore.FillMode.LETTERBOX, true)
	assert_true(InputBlockCore.init())


## Moves the test clock by `ms` of real elapsed time, then lets the core node run its frame check.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await next_frame()


## Waits until the core node has run one frame after this point. Two engine frames: the test may resume after the
## core node ran in this frame.
func next_frame() -> void:
	await UnitTestCore.wait_frames(2)
