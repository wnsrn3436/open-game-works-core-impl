extends RefCounted
## One item of `results` of the result file.

## `<test file path>::<function name>`.
var name: String = ""
## `pass`, `fail` or `skip`.
var status: String = ""
var duration_ms: int = 0
## English. Empty for `pass`.
var message: String = ""
## Engine script runtime errors of the test `check_script_errors` checked.
var checked_script_errors: int = 0
