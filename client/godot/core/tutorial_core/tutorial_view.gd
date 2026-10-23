class_name TutorialView
extends Node
## Tutorial view component: a child of the tutorial view root. Points to the parts of the tutorial view. A button is a
## `Button` with a `UIButton` child.

## Dim that covers the visible game area outside the anchor rectangle. `TutorialCore` puts the highlight shader on it.
@export var dim: ColorRect = null
## Speech bubble. Its size is the speech bubble size.
@export var speech_bubble: Control = null
## Text element of the speech bubble.
@export var text_label: Label = null
## Hand pointer. `TutorialCore` puts its center on the center of the anchor rectangle.
@export var hand_pointer: Control = null
@export var advance_button: Button = null
@export var skip_button: Button = null
