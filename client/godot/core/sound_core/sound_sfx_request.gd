extends RefCounted
## A `play` request whose sound is loading.

var handle: int = 0
var key: String = ""
var bus: int = 0
var priority: int = 0
var scope: Scope = null
## Its load started.
var started: bool = false
