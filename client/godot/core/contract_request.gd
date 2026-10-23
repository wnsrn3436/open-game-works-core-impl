class_name ContractRequest
extends ContractMessage
## Base of the request message classes the contract tool generates: the request message of an `rpc`, with the
## request name and the `rpc` options. A request message class overrides every method.


## Request name: `<Name>`, `core/<Name>`, `cheat/<Name>` or `core/cheat/<Name>`.
func request_name() -> String:
	return ""


## `(ogw.silent)` of the `rpc`.
func is_silent() -> bool:
	return false


## `(ogw.retry)` of the `rpc`.
func is_retry() -> bool:
	return false


## `(ogw.sensitive)` of the `rpc`.
func is_sensitive() -> bool:
	return false


## A new object of the response message of the `rpc`.
func new_response() -> ContractMessage:
	return ContractMessage.new()
