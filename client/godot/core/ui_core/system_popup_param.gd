class_name SystemPopupParam
extends RefCounted
## What `UICore.open_system_popup` shows: a body, an optional extra text and one to three buttons.

## Translation key of the body.
var body: String = ""
## Format arguments of the body. `null`: the body is the translation without formatting.
var format_args: FormatArgs = null
## Shown under the body without translation. Empty: none.
var extra_text: String = ""
## One to three buttons, in order.
var buttons: Array[SystemPopupButton] = []
## Index in `buttons` of the back button: back input presses it. -1: no back button.
var back_button: int = -1
