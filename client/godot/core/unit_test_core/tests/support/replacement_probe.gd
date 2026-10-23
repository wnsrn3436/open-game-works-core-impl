extends RefCounted
## Checks that the modules of a test use the test replacements of `UnitTestCore`: `TimeCore` and `LogCore` the test
## clock, `LogCore` the log collector, `NetworkCore` the fake network.

const START_DEVICE_MS: int = 1700000000000
const LOGIN: String = "core/Login"
const PROBE_TAG: String = "ReplacementProbe"


## Sends one `send_auth` that the fake network holds. Its result arrives when the modules are released.
class AuthSender extends RefCounted:
	var result: AuthSendResult = null

	func send() -> void:
		result = await NetworkCore.send_auth(CoreContract.LoginRequest.new(), AuthSendOptions.new())


## Problems found, empty when every module uses its replacement. `requests_before` is the number of requests the fake
## network had received before. Moves the test clock 1000 ms.
static func problems(requests_before: int, sender: AuthSender) -> PackedStringArray:
	var found: PackedStringArray = PackedStringArray()
	var clock: DevTestClock = UnitTestCore._run.clock
	if TimeCore.get_device_time() != clock.device_time_ms or TimeCore.get_monotonic_time() != clock.monotonic_ms:
		found.append("TimeCore does not read the test clock")
	UnitTestCore.advance_clock(1000, false)
	if TimeCore.get_device_time() != clock.device_time_ms or TimeCore.get_monotonic_time() != clock.monotonic_ms:
		found.append("TimeCore does not follow advance_clock")
	LogCore.log_warn(PROBE_TAG, "probe")
	if UnitTestCore.check_logs("warn", PROBE_TAG) != 1:
		found.append("LogCore does not send its logs to the log collector")
	var line: String = _last_log_line()
	if not line.begins_with("%d\t" % clock.device_time_ms):
		found.append("LogCore does not stamp its log lines with the test clock: %s" % line)
	UnitTestCore.add_pending(LOGIN)
	sender.send()
	var requests: Array[UnitTestRequest] = UnitTestCore.received_requests()
	if requests.size() != requests_before + 1 or requests[requests.size() - 1].name != LOGIN:
		found.append("NetworkCore does not send through the fake network")
	return found


## The last line of the last log file of `LogCore`.
static func _last_log_line() -> String:
	var files: PackedStringArray = LogCoreDev.list_log_files()
	if files.is_empty():
		return ""
	var text: String = FileAccess.get_file_as_string(CoreBuildInfo.storage_root.path_join(files[files.size() - 1]))
	var lines: PackedStringArray = text.strip_edges().split("\n")
	return lines[lines.size() - 1] if not lines.is_empty() else ""
