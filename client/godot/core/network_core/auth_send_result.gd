class_name AuthSendResult
extends RefCounted
## Result of `NetworkCore.send_auth`.

var ok: bool = false
## The response message on success; `null` otherwise.
var response: ContractMessage = null
## The failure; `null` on success.
var failure: RequestFailure = null
