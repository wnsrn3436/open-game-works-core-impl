extends RefCounted
## State of the test that runs now.

## `<test file path>::<function name>`. Empty until GUT starts the test function.
var name: String = ""
## When the test began, in engine ms: its test setup, or the start of its function without a setup.
var started_ms: int = 0
## Whether `UnitTestCase` did the test setup.
var has_setup: bool = false
## GUT fail count when the test began.
var gut_fail_baseline: int = 0
## Failure texts of the asserts of the test.
var assert_failures: PackedStringArray = PackedStringArray()
## Failures `UnitTestCore` found: unchecked error logs, requests without a result, time limit, wrong calls.
var fail_reasons: PackedStringArray = PackedStringArray()
## Not empty when `require_platform` ended the test as a skip.
var skip_reason: String = ""
var timed_out: bool = false
## Whether the test result is recorded.
var judged: bool = false
## Whether `UnitTestCase.after_each` did the end checks of the test. The engine script runtime errors after them come
## between tests.
var finished: bool = false
## Base URLs of the loopback HTTP servers the test made.
var servers: PackedStringArray = PackedStringArray()
## Test host URLs (`<test host>/ws-servers/<n>`) of the WebSocket relays the test opened.
var relays: PackedStringArray = PackedStringArray()
## Latches made in the test; the time limit ends their waits.
var latches: Array[UnitTestLatch] = []
## Engine script runtime errors counted before the test began.
var script_errors_base: int = 0
## Engine script runtime errors of the test `check_script_errors` checked.
var checked_script_errors: int = 0
