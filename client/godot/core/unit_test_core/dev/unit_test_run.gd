extends RefCounted
## State of one test run: its config, results and the state of the test that runs now.

## A nested run stopped because its test did not return after its test time limit. GUT does not end that run.
signal stopped
## A GUT run that ended before its last test sent its release signal.
signal released

const _CONFIG := preload("res://core/unit_test_core/dev/unit_test_config.gd")
const _STATE := preload("res://core/unit_test_core/dev/unit_test_state.gd")
const _LOG := preload("res://core/unit_test_core/dev/unit_test_log.gd")
const _RESULT := preload("res://core/unit_test_core/dev/unit_test_result.gd")
const _FAKE_NETWORK := preload("res://core/unit_test_core/dev/unit_test_fake_network.gd")

var config: _CONFIG = _CONFIG.new()
## `core` or `regression`.
var kind: String = "core"
## Whether render tests run: a render pass or a browser run.
var render_pass: bool = false
var started_at: int = 0
var finished_at: int = 0
var test_time_limit_ms: int = 0
## GUT run of this run. Null before the pre-run hook attaches one.
var gut: GutMain = null
## App storage files and folders at the start of the run. A folder path ends with `/`.
var storage_files: Dictionary[String, bool] = {}
var results: Array[_RESULT] = []
var run_failures: PackedStringArray = PackedStringArray()
var warn_counts: Dictionary[String, int] = {}
## Paths of the test files GUT made an instance of.
var seen_scripts: Dictionary[String, bool] = {}
## Name of the last test that ended, for the run failure of error logs between tests.
var previous_test: String = "before run"
## Test that runs now, or null between tests.
var test: _STATE = null
## Logs the collector received since the test setup, or since the last test ended.
var logs: Array[_LOG] = []
## Engine script runtime errors counted when the last test ended, or when the run began.
var script_errors_mark: int = 0
var clock: DevTestClock = null
var network: _FAKE_NETWORK = null
## Whether the run sent its result or ended.
var ended: bool = false
## Whether the GUT run that ended before its last test sent its release signal.
var release_sent: bool = false
