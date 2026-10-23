extends RefCounted
## A registered scope release listener.

var callback: Callable = Callable()
## True once removed. A release that started before the removal skips it.
var removed: bool = false
## True once the error of a listener whose object is gone was logged.
var invalid_logged: bool = false
