class_name PushConsentInfo
extends RefCounted
## Ad push consent of the session user, as `PushCore.get_push_consent` returns it.

## Whether the user gets ad push.
var push_ad: CoreContract.ConsentChoice = CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED
## Whether the user gets ad push at night too.
var push_night: CoreContract.ConsentChoice = CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED
