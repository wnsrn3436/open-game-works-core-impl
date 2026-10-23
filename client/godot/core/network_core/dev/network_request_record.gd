class_name NetworkRequestRecord
extends RefCounted
## One request record of `NetworkCoreDev.get_request_records`.

var request_name: String = ""
var kind: NetworkCore.RequestKind = NetworkCore.RequestKind.INTERACTION
var ok: bool = false
## The last error code; 0 when the request ended without one.
var error_code: int = 0
## Empty for `send_auth` and sensitive requests.
var request_body: PackedByteArray = PackedByteArray()
## The last response message bytes. Empty for `send_auth` and sensitive requests.
var response_body: PackedByteArray = PackedByteArray()
