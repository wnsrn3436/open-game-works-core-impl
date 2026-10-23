extends UIParam
## Param of the core popups `TermsPopup`, `AgePopup`, `PrivacyChoicesPopup` and `PushConsentPopup`. The popup keeps
## its answer here and closes with `on_result` as the after-close callback.

## Result callback.
var on_result: Callable = Callable()
## Opens a document URL with the OS and returns a success flag. Terms popup only.
var open_url: Callable = Callable()
## Document URL of `TERMS`. Terms popup only.
var terms_url: String = ""
## Document URL of `PRIVACY`. Terms popup only.
var privacy_url: String = ""
## State of the first toggle: terms, ad personalization or ad push. Holds the initial state on open.
var first_on: bool = false
## State of the second toggle: privacy, analytics or night ad push. Holds the initial state on open.
var second_on: bool = false
## True when the popup closed by its confirm button.
var confirmed: bool = false
## Birth year and month as `yyyymm`. Age popup only.
var birth_year_month: int = 0
## `auth.maxAgeYears`. Age popup only.
var max_age_years: int = 0
