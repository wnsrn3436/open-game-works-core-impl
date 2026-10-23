extends RefCounted
## One `warn` or `error` log the log collector of `UnitTestCore` received.

## `warn` or `error`.
var level: String = ""
var tag: String = ""
var message: String = ""
## Whether `check_logs` counted it.
var checked: bool = false
