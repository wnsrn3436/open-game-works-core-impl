extends SessionProvider
## Session provider of the QACore core tests: an access token at once, so cheat requests reach the fake network.


func get_access_token() -> GetAccessTokenResult:
	var result: GetAccessTokenResult = GetAccessTokenResult.new()
	result.ok = true
	result.access_token = "qa-test-access-token"
	return result


func refresh_access_token() -> GetAccessTokenResult:
	return get_access_token()


func get_signing_key() -> String:
	return "qa-test-signing-key"
