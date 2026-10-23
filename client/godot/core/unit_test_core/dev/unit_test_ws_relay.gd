class_name UnitTestWsRelay
extends RefCounted
## A WebSocket relay on the test host: the result of `UnitTestCore.open_ws_relay`. Both URLs are empty on failure.

## URL the client connects to, alone or with a path and query after it.
var url: String = ""
## URL the test connects to, to see the client connections and to send to and close them.
var control_url: String = ""
