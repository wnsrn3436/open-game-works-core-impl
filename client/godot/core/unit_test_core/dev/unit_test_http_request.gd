class_name UnitTestHttpRequest
extends RefCounted
## One request a loopback HTTP server received: an item of `UnitTestCore.http_requests`.

## Path after the base URL, with its leading `/`.
var path: String = ""
## Headers as `[name, value]` pairs in the received order.
var headers: Array[PackedStringArray] = []
var body: PackedByteArray = PackedByteArray()
