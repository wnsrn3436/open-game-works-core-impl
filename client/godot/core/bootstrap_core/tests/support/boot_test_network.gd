extends RefCounted
## Fake network results of the BootstrapCore core tests that log in.

const DEV_LOGIN: String = "core/cheat/DevLogin"
const ISSUE_DELETION_CODE: String = "core/IssueDeletionCode"
const GET_NOTICES: String = "core/GetNotices"
const REPORT_CLIENT_ERRORS: String = "core/ReportClientErrors"
const USER_ID: int = 4242
const PUBLIC_CODE: String = "K7M2Q9XA"
const SERVER_TIME_AT: int = 1700000000000
const DELETION_URL: String = "https://example.com/delete"


## A `DevLogin` success.
static func add_dev_login_success() -> void:
	add_body(DEV_LOGIN, _dev_login_success_body())


## Gives the first pending `DevLogin` request a success.
static func release_pending_dev_login_success() -> bool:
	var envelope := CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME_AT
	envelope.body = _dev_login_success_body()
	return UnitTestCore.release_pending(DEV_LOGIN, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(envelope))


static func _dev_login_success_body() -> PackedByteArray:
	var auth := CoreContract.AuthResult.new()
	auth.user_id = USER_ID
	auth.public_code = PUBLIC_CODE
	auth.user_created_at = SERVER_TIME_AT
	auth.login_token = "login-token"
	auth.access_token = "access-token"
	auth.access_token_expires_at = SERVER_TIME_AT + 3600000
	auth.session_signing_key = "signing-key"
	var response := CoreCheatContract.DevLoginResponse.new()
	response.result = auth
	return response.encode()


## A `DevLogin` server error `code`. `ban_until_at` is the ban end of a `CORE_ERROR_BANNED` error.
static func add_dev_login_error(code: int, ban_until_at: int = 0) -> void:
	var error := CoreContract.ServerError.new()
	error.code = code
	if code == CoreContract.CoreError.CORE_ERROR_BANNED:
		var ban := CoreContract.BanDetail.new()
		ban.user_id = USER_ID
		ban.public_code = PUBLIC_CODE
		ban.until_at = ban_until_at
		ban.deletion_url = DELETION_URL
		ban.access_token = "ban-access-token"
		ban.session_signing_key = "ban-signing-key"
		error.ban = ban
	add_error(DEV_LOGIN, error)


## An `IssueDeletionCode` success.
static func add_deletion_code(code: String, expires_at: int) -> void:
	var response := CoreContract.IssueDeletionCodeResponse.new()
	response.code = code
	response.expires_at = expires_at
	response.url = DELETION_URL
	add_body(ISSUE_DELETION_CODE, response.encode())


## Gives the first pending `IssueDeletionCode` request a success.
static func release_pending_deletion_code(code: String, expires_at: int) -> bool:
	var response := CoreContract.IssueDeletionCodeResponse.new()
	response.code = code
	response.expires_at = expires_at
	response.url = DELETION_URL
	var envelope := CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME_AT
	envelope.body = response.encode()
	return UnitTestCore.release_pending(
		ISSUE_DELETION_CODE, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(envelope)
	)


## `count` `ReportClientErrors` successes: the error logs a logged-in boot sends to the server.
static func add_error_reports(count: int) -> void:
	for i: int in count:
		add_body(REPORT_CLIENT_ERRORS, CoreContract.ReportClientErrorsResponse.new().encode())


## An empty `GetNotices` success: no maintenance.
static func add_no_notices() -> void:
	add_body(GET_NOTICES, CoreContract.GetNoticesResponse.new().encode())


## Gives the first pending `request_name` request a connection failure.
static func release_pending_failure(request_name: String) -> bool:
	return UnitTestCore.release_pending(request_name, NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray())


static func add_body(request_name: String, body: PackedByteArray) -> void:
	var envelope := CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME_AT
	envelope.body = body
	_add(request_name, envelope)


static func add_error(request_name: String, error: CoreContract.ServerError) -> void:
	var envelope := CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME_AT
	envelope.error = error
	_add(request_name, envelope)


static func _add(request_name: String, envelope: CoreContract.ResponseEnvelope) -> void:
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(envelope))
