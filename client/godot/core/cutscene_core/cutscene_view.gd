class_name CutsceneView
extends Node
## Cutscene view component: a child of the cutscene view root. It points at the parts of the view. A missing optional
## part is `null`. Every button is a `Button` with a `UIButton` child.

## Parent of staging instances that have no actor. It has a `SafeAreaIgnore` child.
@export var staging_parent: Control = null
@export var dialogue_box: Control = null
@export var speaker_label: Label = null
@export var portrait: TextureRect = null
## The rich text element of the line text.
@export var text_label: RichTextLabel = null
## One or more. The choice text is `Button.text`. Put them outside the dialogue box.
@export var choice_buttons: Array[Button] = []
@export var advance_button: Button = null
@export var skip_button: Button = null
## Optional. `toggle_mode` is true.
@export var auto_advance_button: Button = null
## Optional. `toggle_mode` is true.
@export var fast_forward_button: Button = null
## Optional: the four line history parts are all there or all `null`.
@export var line_history_button: Button = null
@export var line_history_window: Control = null
@export var line_history_list: UIScrollList = null
@export var line_history_close_button: Button = null
