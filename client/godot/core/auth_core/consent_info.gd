class_name ConsentInfo
extends RefCounted
## Age and privacy choices of the session user, as `AuthCore.get_consent` returns them.

## True when the age is confirmed.
var age_confirmed: bool = false
## Start age of the age band.
var age_from: int = 0
## End age of the age band.
var age_to: int = 0
## True when the age band is a child.
var child: bool = true
## True when the age band is below the digital consent age.
var below_consent_age: bool = true
## True when ads may be personalized.
var ad_personalization_allowed: bool = false
## True when analytics events may be collected.
var analytics_allowed: bool = false
## Tracking permission state of this device.
var tracking: CoreContract.TrackingStatus = CoreContract.TrackingStatus.TRACKING_STATUS_UNSPECIFIED
## Ad push choice.
var push_ad: CoreContract.ConsentChoice = CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED
## Night ad push choice.
var push_night: CoreContract.ConsentChoice = CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED


## True when every field of `other` is the same as this one.
func equals(other: ConsentInfo) -> bool:
	return (
		other != null
		and age_confirmed == other.age_confirmed
		and age_from == other.age_from
		and age_to == other.age_to
		and child == other.child
		and below_consent_age == other.below_consent_age
		and ad_personalization_allowed == other.ad_personalization_allowed
		and analytics_allowed == other.analytics_allowed
		and tracking == other.tracking
		and push_ad == other.push_ad
		and push_night == other.push_night
	)
