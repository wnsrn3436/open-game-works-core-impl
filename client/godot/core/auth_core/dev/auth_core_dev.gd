class_name AuthCoreDev
extends RefCounted
## DEV operations of AuthCore: dev login, the fake social account, access token expiry and the fake tracking state.

const _WAIT := preload("res://core/auth_core/auth_wait.gd")
const _DEV_TOKEN_STORAGE := preload("res://core/auth_core/dev/adapters/dev_token_storage.gd")


## Logs in with a dev account name through `DevLogin`. Does not check the terms or the install marker, and does not
## read or write the storage item or the pending token.
static func dev_login(account_name: String) -> LoginResult:
	if not AuthCore._check("dev_login"):
		return AuthCore._login_result(AuthCore.LoginStatus.FAILED)
	var life: RefCounted = AuthCore._life
	var request: CoreCheatContract.DevLoginRequest = CoreCheatContract.DevLoginRequest.new()
	request.account_name = account_name
	var options: AuthSendOptions = AuthSendOptions.new()
	var wait: _WAIT = _WAIT.new()
	AuthCore._waits.append(wait)
	var job: Callable = func() -> void:
		var sent: AuthSendResult = await NetworkCoreDev.send_auth_cheat(request, options)
		wait.finish(sent)
	job.call()
	if not wait.finished:
		await wait.done
	AuthCore._waits.erase(wait)
	var result: AuthSendResult = wait.result as AuthSendResult
	if life != AuthCore._life:
		return AuthCore._login_result(AuthCore.LoginStatus.FAILED)
	if result == null or not result.ok:
		return AuthCore._login_failure(result)
	var response: CoreCheatContract.DevLoginResponse = result.response as CoreCheatContract.DevLoginResponse
	if response == null or response.result == null:
		LogCore.log_error(AuthCore._TAG, "dev_login: response has no result")
		return AuthCore._login_result(AuthCore.LoginStatus.FAILED)
	return AuthCore._open_session(response.result)


## Fake account name the fake social adapter uses for the next social login and account link.
static func set_fake_social_account(account_name: String) -> void:
	AuthCore._fake_social_account = account_name


## Sets the access token expiry in memory to the server time now.
static func expire_access_token() -> void:
	if AuthCore._session != null:
		AuthCore._session.access_token_expires_at = TimeCore.get_server_time()


## Device tracking state and the answer of the tracking permission request.
static func set_fake_tracking_status(status: CoreContract.TrackingStatus) -> void:
	AuthCore._fake_tracking = status


## Gives AuthCore the DEV token storage before `init`. `init` uses it outside the browser runtime when there is no
## `ogw-secure-storage` singleton.
static func use_dev_token_storage() -> void:
	AuthCore._dev_storage = _DEV_TOKEN_STORAGE.new()
