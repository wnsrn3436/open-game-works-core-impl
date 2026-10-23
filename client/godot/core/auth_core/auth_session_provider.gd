extends SessionProvider
## The `SessionProvider` AuthCore passes to `NetworkCore.set_session_provider` at login.


func get_access_token() -> GetAccessTokenResult:
	return await AuthCore._provide_access_token(false)


func refresh_access_token() -> GetAccessTokenResult:
	return await AuthCore._provide_access_token(true)


func get_signing_key() -> String:
	return AuthCore._signing_key()


func notify_session_replaced() -> void:
	AuthCore._on_session_replaced()
