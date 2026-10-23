class_name UnitTestRequest
extends RefCounted
## One request the fake network of `UnitTestCore` received: an item of `UnitTestCore.received_requests`.

## Request name: the URL path after the server base URL, for example `core/Login`.
var name: String = ""
## Request headers as `Name: value` lines.
var headers: PackedStringArray = PackedStringArray()
var body: PackedByteArray = PackedByteArray()
