extends RefCounted
## Test run config of one run (`client-core` Godot `## test`).

var run_id: String = ""
## Test host URL, `http://127.0.0.1:<port>`.
var test_host: String = ""
var has_core_fixture_dir: bool = false
var core_fixture_dir: String = ""
var has_shared_fixture_dir: bool = false
var shared_fixture_dir: String = ""
