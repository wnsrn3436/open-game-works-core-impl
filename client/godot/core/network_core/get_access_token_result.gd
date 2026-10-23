class_name GetAccessTokenResult
extends RefCounted
## Result of `SessionProvider.get_access_token` and `SessionProvider.refresh_access_token`.

var ok: bool = false
## The access token on success.
var access_token: String = ""
## The failure; `null` on success.
var failure: RequestFailure = null
