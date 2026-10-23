class_name SocialAdapter
extends RefCounted
## Base of the client social adapters. A social adapter does the sign-in of one provider and returns the credential
## server `auth` checks. `BootstrapCore` passes one per provider with `AuthCore.set_social_adapter`.

enum SignInStatus { SUCCESS, CANCELLED, FAILED }


## Result of `sign_in`.
class SignInResult extends RefCounted:
	var status: SignInStatus = SignInStatus.FAILED
	## Credential. Filled only for `SUCCESS`.
	var credential: String = ""

	func _init(value: SignInStatus = SignInStatus.FAILED, text: String = "") -> void:
		status = value
		credential = text


## True when this adapter works on `platform` (`CoreBuildInfo.platform`).
func is_supported(_platform: String) -> bool:
	return false


## Signs in with the provider and waits for the result.
func sign_in() -> SignInResult:
	return SignInResult.new()


## Ends the `sign_in` that waits with `FAILED`. `AuthCore.release` calls it before it drops the adapter.
func stop() -> void:
	pass
