class_name UnitTestCase
extends GutTest
## Base of the core tests and the client regression tests. `before_each` does the test setup of `UnitTestCore`;
## `after_each` checks the test at its end, unchecked error logs and script runtime errors, and then deletes the
## loopback HTTP servers and the WebSocket relays of the test and waits for the test host. A test that overrides
## `before_each` calls `super()` first; one that overrides `after_each` calls `await super()` first, so the next test
## starts after the deletes. In the headless pass of a core test, `should_skip_script` skips a render test file
## (`test_render_*.gd`).

## True while the end checks report their failures to GUT, so the failure texts are not kept twice.
var _reporting: bool = false


func before_each() -> void:
	UnitTestCore._setup_test()


func after_each() -> void:
	_reporting = true
	for reason: String in UnitTestCore._finish_test():
		fail_test(reason)
	_reporting = false
	await UnitTestCore._delete_test_servers()


func should_skip_script() -> bool:
	return UnitTestCore._skip_script(self)


## GUT records an assert failure. Keeps its text for the result file.
# ogw:input_boundary
func _fail(text: Variant) -> void:
	var message: String = str(text)
	if not _reporting:
		UnitTestCore._note_assert_failure(message)
	super(message)
