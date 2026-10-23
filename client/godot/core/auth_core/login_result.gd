class_name LoginResult
extends RefCounted
## Result of `AuthCore.boot_login`, `AuthCore.login`, `AuthCore.switch_account` and `AuthCoreDev.dev_login`.

## Status of the login.
var status: AuthCore.LoginStatus = AuthCore.LoginStatus.FAILED
## User ID. Filled only for `SUCCESS` and `BANNED`.
var user_id: int = 0
## Time the ban ends. Unix ms. Filled only for `BANNED`; 0 when the ban does not end.
var ban_until_at: int = 0
## Address of the web account deletion page. Filled only for `BANNED`.
var deletion_url: String = ""
## Server error code. Filled only when `FAILED` comes from a server error.
var error_code: int = 0
