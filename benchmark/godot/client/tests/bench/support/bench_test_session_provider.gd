class_name BenchTestSessionProvider
extends SessionProvider
## `SessionProvider` of the bench regression tests: every call gets an access token, so requests reach the fake network.


func get_access_token() -> GetAccessTokenResult:
	return _token()


func refresh_access_token() -> GetAccessTokenResult:
	return _token()


func get_signing_key() -> String:
	return "signing-key"


func _token() -> GetAccessTokenResult:
	var result: GetAccessTokenResult = GetAccessTokenResult.new()
	result.ok = true
	result.access_token = "access-token"
	return result
