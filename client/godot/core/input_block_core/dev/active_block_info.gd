class_name ActiveBlockInfo
extends RefCounted
## One active block in the buffer of `InputBlockCoreDev.list_active`.

var reason: String = ""
## `<file>:<line>` of the code that called `block`, or an empty string when it could not be read.
var caller_location: String = ""
var elapsed_ms: int = 0
