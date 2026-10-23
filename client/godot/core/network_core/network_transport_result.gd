class_name NetworkTransportResult
extends RefCounted
## Result of `NetworkTransport.send`.

## The handle the send received.
var handle: int = 0
var transfer: NetworkCore.TransferResult = NetworkCore.TransferResult.CONNECTION_FAILED
## HTTP status; 0 when no response came.
var http_status: int = 0
var body: PackedByteArray = PackedByteArray()
