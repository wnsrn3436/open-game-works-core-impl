class_name InputPrompt
extends RefCounted
## Input prompt of an action that `InputCore.get_prompt` fills: what to show for the input that presses it.

## Prompt family the prompt is for.
var family: GameData.InputPromptFamily = GameData.InputPromptFamily.TOUCH
## Prompt input: the string that finds the `input_prompt` row.
var input: String = ""
## Resource key of the row's `icon`. Empty when there is no row or the row has no icon.
var icon: String = ""
## Translation key of the row's `name`. Empty (none) when there is no row.
var name_key: String = ""
