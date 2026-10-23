class_name TutorialStepStartedEvent
extends EventBase
## Core event: step progress 1 of a tutorial step. A `Paused` tutorial publishes it too.

## Tutorial ID value.
var tutorial_id: int = 0
## `step` of the step that started.
var step: int = 0
