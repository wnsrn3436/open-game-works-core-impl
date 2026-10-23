class_name AuthSendOptions
extends RefCounted
## Options of `NetworkCore.send_auth`.

## Token for `Authorization`; an empty string leaves the header out.
var authorization: String = ""
## Attaches the request signature.
var sign: bool = false
## Session signing key of the signature; an empty string uses `SessionProvider.get_signing_key`.
var signing_key: String = ""
