extends SocialAdapter
## Social adapter of the PaymentCore core tests: usable on every platform. PaymentCore only asks whether it is usable.


func is_supported(_platform: String) -> bool:
	return true
