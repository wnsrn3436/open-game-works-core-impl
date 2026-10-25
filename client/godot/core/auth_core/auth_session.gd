extends RefCounted
## Login session of AuthCore in memory: the tokens and what the login response returned.

## Access token.
var access_token: String = ""
## Time the access token expires. Unix ms.
var access_token_expires_at: int = 0
## Session signing key.
var signing_key: String = ""
## Login token of the response that opened the session.
var login_token: String = ""
## User ID.
var user_id: int = 0
## Public code of the user: of `AuthResult` for a session, of the ban detail for a ban session.
var public_code: String = ""
## Linked providers (`CoreContract.LoginProvider` values).
var linked_providers: PackedInt32Array = PackedInt32Array()
## Consent of the session user. `null` until a response gives it.
var consent: CoreContract.ConsentUserState = null
