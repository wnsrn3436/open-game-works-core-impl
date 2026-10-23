extends RefCounted
## LogCore core test helper: the test clock and the listener and sender of one test, and the log folder of the
## test app storage root.

## App storage root of the LogCore core tests.
const ROOT: String = "user://log_core_test/"
const START_DEVICE_TIME_MS: int = 1700000000000

var clock: DevTestClock = DevTestClock.new()
var levels: Array[LogCore.Level] = []
var tags: PackedStringArray = PackedStringArray()
var messages: PackedStringArray = PackedStringArray()
var batches: Array[LogBatch] = []
## Monotonic time of each sender call.
var send_times: PackedInt64Array = PackedInt64Array()
## When not empty, the sender logs an `error` with this message during the call.
var error_in_sender: String = ""
## Calls of the static listener `static_listen`. The test that sets it resets it.
static var static_calls: int = 0


func _init() -> void:
	clock.device_time_ms = START_DEVICE_TIME_MS


## Gives LogCore this test clock and listener. Before `LogCore.init`.
func install() -> void:
	LogCoreDev.set_test_clock(clock)
	LogCoreDev.set_log_listener(listen)


func listen(level: LogCore.Level, tag: String, message: String) -> void:
	levels.append(level)
	tags.append(tag)
	messages.append(message)


## Listener that takes one more argument. Given only through a `bind()`.
func listen_from(level: LogCore.Level, tag: String, message: String, source: String) -> void:
	listen(level, tag, "%s: %s" % [source, message])


static func static_listen(_level: LogCore.Level, _tag: String, _message: String) -> void:
	static_calls += 1


func send(batch: LogBatch) -> void:
	batches.append(batch)
	send_times.append(clock.monotonic_ms)
	if not error_in_sender.is_empty():
		LogCore.log_error("test", error_in_sender)


## Listener calls of `level` and `tag`.
func count(level: LogCore.Level, tag: String) -> int:
	var found: int = 0
	for i: int in levels.size():
		if levels[i] == level and tags[i] == tag:
			found += 1
	return found


## Listener calls of `level`, `tag` and `message`.
func count_message(level: LogCore.Level, tag: String, message: String) -> int:
	var found: int = 0
	for i: int in levels.size():
		if levels[i] == level and tags[i] == tag and messages[i] == message:
			found += 1
	return found


func advance(ms: int) -> void:
	clock.monotonic_ms += ms
	clock.device_time_ms += ms


static func log_dir() -> String:
	return ROOT + "log"


static func file_path(number: int) -> String:
	return "%s/log_%d.txt" % [log_dir(), number]


## Lines of `log_<number>.txt`, without the final LF of each.
static func read_lines(number: int) -> PackedStringArray:
	var path: String = file_path(number)
	if not FileAccess.file_exists(path):
		return PackedStringArray()
	return FileAccess.get_file_as_string(path).split("\n", false)


## The five fields of a log line.
static func fields(line: String) -> PackedStringArray:
	return line.split("\t", true)


## A field of a log line with its escapes undone.
static func unescape(text: String) -> String:
	var out: String = ""
	var i: int = 0
	while i < text.length():
		var c: String = text[i]
		if c == "\\" and i + 1 < text.length():
			var next: String = text[i + 1]
			match next:
				"\\":
					out += "\\"
				"t":
					out += "\t"
				"n":
					out += "\n"
				"r":
					out += "\r"
				_:
					out += c + next
			i += 2
			continue
		out += c
		i += 1
	return out


static func write_file(path: String, text: String) -> void:
	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	if file != null:
		file.store_string(text)
		file.close()


## Deletes the test app storage root with everything in it.
static func clean() -> void:
	var log_path: String = log_dir()
	if DirAccess.dir_exists_absolute(log_path):
		for file_name: String in DirAccess.get_files_at(log_path):
			DirAccess.remove_absolute(log_path + "/" + file_name)
		DirAccess.remove_absolute(log_path)
	elif FileAccess.file_exists(log_path):
		DirAccess.remove_absolute(log_path)
	if DirAccess.dir_exists_absolute(ROOT):
		DirAccess.remove_absolute(ROOT)
