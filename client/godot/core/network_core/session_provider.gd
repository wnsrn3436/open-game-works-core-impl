class_name SessionProvider
extends RefCounted
## The session that `AuthCore` gives `NetworkCore.set_session_provider`. `AuthCore` overrides every method.


## Waits and returns the access token of the session.
func get_access_token() -> GetAccessTokenResult:
	return GetAccessTokenResult.new()


## Waits and returns a newly received access token, whatever time the current one has left.
func refresh_access_token() -> GetAccessTokenResult:
	return GetAccessTokenResult.new()


## Session signing key; an empty string when there is none.
func get_signing_key() -> String:
	return ""


## Tells the session that the server refused its request with `SESSION_REPLACED`.
func notify_session_replaced() -> void:
	pass
