class_name UISystemPopup
extends UIPopup
## Root script of the `UICore.systemPopupResource` prefab that sets where the system popup content goes. Popups of
## `UICore.open_popup` do not use it.

## The body and extra text fill this `Control` of the prefab. `null`: the part of the root above the button area.
@export var body_area: Control = null
## The buttons are in one row in this `Control` of the prefab. `null`: a strip along the bottom edge of the root.
@export var button_area: Control = null
