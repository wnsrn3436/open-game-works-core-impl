class_name AdsAdapter
extends RefCounted
## Base of the ads adapters. An ads adapter wraps one ads SDK and keeps every SDK-specific step inside it. Only
## `AdCore` calls an ads adapter; `BootstrapCore` passes one with `AdCore.set_ads_adapter`. The async operations
## (`request_ad_consent`, `show_privacy_options`, `initialize`, `load_ad`, `present`, `open_banner`) may await;
## `AdCore` awaits them. The spec adapter operation `load` is `load_ad` here so that it does not shadow the global
## `load()`.


## Ad consent. `AdCore` makes it from `AuthCore.get_consent` for every call that takes it, and the adapter passes it
## to the ads SDK request parameters.
class AdConsent extends RefCounted:
	var ad_personalization_allowed: bool = false
	var child: bool = true
	var below_consent_age: bool = true


## Result of `request_ad_consent`.
class ConsentResult extends RefCounted:
	## False when the consent request failed.
	var ok: bool = false
	## The region asks for ads consent.
	var required: bool = false
	## The user agreed to personalization on the ads consent screen.
	var personalized: bool = false


## Verification value of a rewarded `present`: the adapter puts it into the server-side verification custom data
## of the loaded rewarded ad before it shows the ad.
class Verification extends RefCounted:
	var user_id: int = 0
	var notify_id: String = ""


## Time limit of `initialize`, `load_ad` and `open_banner`, ms: `AdCore.sdkCallTimeoutMs`. Set by `AdCore.init`. Past it
## the call fails. The operations that wait for the user have no time limit.
var call_timeout_ms: int = 0


## Async. Shows the ads consent screen when it is needed and waits until it closes.
func request_ad_consent() -> ConsentResult:
	return ConsentResult.new()


## Whether an entry that changes the ads consent is needed.
func is_privacy_options_required() -> bool:
	return false


## Async. Opens the ads consent change screen. True when it opened.
func show_privacy_options() -> bool:
	return false


## Async. Initializes the ads SDK. A second call in one process succeeds without initializing the SDK again.
func initialize(_consent: AdConsent) -> bool:
	return false


## Async. Loads an ad of `ad_type` (`REWARDED` or `INTERSTITIAL`) for `unit_id`.
func load_ad(_ad_type: GameData.AdType, _unit_id: String, _consent: AdConsent) -> bool:
	return false


## Async. Shows the loaded ad and waits until it closes. Returns `COMPLETED`, `ABORTED` or `FAILED`; an interstitial
## ad that was shown and closed is `COMPLETED`. `verification` is `null` for an interstitial ad.
func present(_ad_type: GameData.AdType, _unit_id: String, _verification: Verification) -> AdCore.AdShowResult:
	return AdCore.AdShowResult.FAILED


## Async. Opens a banner for `unit_id`.
func open_banner(_unit_id: String, _consent: AdConsent) -> bool:
	return false


## Closes the banner that is open.
func close_banner() -> void:
	pass


## Drops every loaded ad. `AdCore.release` calls it.
func release() -> void:
	pass


## The unit ID of a placement: `listed` is the value of the ad unit list, or an empty string.
func _unit_id(_placement_id: int, listed: String) -> String:
	return listed
