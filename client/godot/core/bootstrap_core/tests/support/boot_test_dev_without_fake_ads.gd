extends BootstrapCoreDev
## DEV entry of the BootstrapCore core tests that cannot make the fake ads adapter: the fake value of adapter key
## `ads` is then a value that could not be passed.


func make_fake_ads_adapter() -> AdsAdapter:
	return null
