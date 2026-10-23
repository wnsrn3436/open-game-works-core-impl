extends RefCounted
## One `GetRemoteConfig` send of `RemoteConfigCore.refresh`. Every `refresh` call made while it runs waits on `done`;
## `release` finishes it with failure.

signal done

## True after `finish`.
var finished: bool = false
## Success flag `finish` left.
var ok: bool = false
## Response the success callback received. `null` until then.
var response: CoreContract.GetRemoteConfigResponse = null


## Success callback of `NetworkCore.send`.
func on_success(message: ContractMessage) -> void:
	response = message as CoreContract.GetRemoteConfigResponse


## Leaves `success` and resumes the waiting calls. Later calls do nothing.
func finish(success: bool) -> void:
	if finished:
		return
	finished = true
	ok = success
	done.emit()
