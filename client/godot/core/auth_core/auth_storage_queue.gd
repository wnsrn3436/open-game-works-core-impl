extends RefCounted
## Order of the login token storage operations. An operation starts after the one started before it ends, also
## across `release` and the next `init`.

const _WAIT := preload("res://core/auth_core/auth_wait.gd")

## End of the operation started last. `null` when none was started.
var tail: _WAIT = null
