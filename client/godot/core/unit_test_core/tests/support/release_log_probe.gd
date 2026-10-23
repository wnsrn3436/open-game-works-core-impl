extends RefCounted
## Module of the UnitTestCore core tests whose `release` logs an error, as a module that fails in its release. A test
## puts its entry in the module list of `BootstrapCore`, so the `BootstrapCore.shutdown` of the next test setup
## releases it.

const TAG: String = "ReleaseLogProbe"
const MESSAGE: String = "release failed"

static var _initialized: bool = false


static func init() -> bool:
	_initialized = true
	return true


static func release() -> void:
	_initialized = false
	LogCore.log_error(TAG, MESSAGE)


static func is_initialized() -> bool:
	return _initialized
