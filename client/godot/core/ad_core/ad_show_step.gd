extends RefCounted
## What one `AdCore.show` did inside its `run_blocked` operation.

var placement_id: int = 0
var ad_type: GameData.AdType = GameData.AdType.NONE
var unit_id: String = ""
var user_id: int = 0
## The `run_blocked` operation ran: the block was put.
var ran: bool = false
## `BeginAdReward` failed; `present` was not called.
var begin_failed: bool = false
## `BeginAdReward` failed with `AD_LIMIT_REACHED`.
var limit_reached: bool = false
## Reward notify ID of the `BeginAdReward` response.
var notify_id: String = ""
## Result of `present`.
var present_result: AdCore.AdShowResult = AdCore.AdShowResult.FAILED
