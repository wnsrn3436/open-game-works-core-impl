extends RefCounted
## A focus target: a panel or popup instance, or a view focus. Holds its focus element.

## The instance root, or `null` for a view focus.
var instance: Control = null
## The element that has or gets the focus while this is the focus target. `null`: pick by the first rule.
var focus_element: Control = null
