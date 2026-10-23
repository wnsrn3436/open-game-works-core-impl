class_name RequestFailure
extends RefCounted
## The failure of a request. The caller does not keep it outside the failure callback.

## `NetworkCore.FailureKind` of the failure.
var kind: NetworkCore.FailureKind = NetworkCore.FailureKind.CONNECTION_FAILED
## `CoreError` or `GameError` value for `SERVER_ERROR`; 0 otherwise.
var error_code: int = 0
## Request name. Example: `core/Resync`.
var request_name: String = ""
## HTTP status; 0 when no response came.
var http_status: int = 0
## Server detail; an empty string when there is none.
var server_detail: String = ""
## `ServerError.ban` when `error_code` is `BANNED`; `null` otherwise.
var ban: CoreContract.BanDetail = null
