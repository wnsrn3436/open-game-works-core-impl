class_name BenchConstants
extends RefCounted
## Drawing values of the bench feature. Gameplay values are in `game_setting`.

## Turns of the spiral the arena shapes start on.
const ARENA_SPIRAL_TURNS: float = 7.0 # look of the drawing only; no rule reads it
## Radius of the outer arena orbit as a part of the shorter side of the field.
const ARENA_OUTER_RADIUS: float = 0.45 # layout of the drawing only; no rule reads it
## Radius of the inner arena orbit as a part of the outer orbit.
const ARENA_INNER_RADIUS: float = 0.15 # layout of the drawing only; no rule reads it
## Saturation and value of the arena shape colors; the hue goes round the shapes.
const ARENA_SATURATION: float = 0.7 # color of the drawing only; no rule reads it
const ARENA_VALUE: float = 0.95 # color of the drawing only; no rule reads it
## Permille of a whole.
const PERMILLE: int = 1000 # unit conversion, not a tunable value
