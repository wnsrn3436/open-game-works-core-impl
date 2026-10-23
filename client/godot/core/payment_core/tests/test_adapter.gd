extends "res://core/payment_core/tests/support/payment_test_case.gd"
## The store adapters. `BootstrapCore` selects the adapter by platform and build info `adapters` in its boot; the
## core test of that selection is in the dev run boot tests of `BootstrapCore`.


func test_real_adapter_without_its_plugin_fails_to_prepare() -> void:
	assert_true(start_modules())
	assert_true(await prepare_modules())
	assert_true(start_auth(false))
	PaymentCore.set_store_adapter(PluginStoreAdapter.new(CoreContract.IapStore.IAP_STORE_APPLE))
	assert_true(PaymentCore.init())
	assert_true(PaymentCore.is_supported())
	assert_false(await PaymentCore.prepare())
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)


func test_store_adapters_declare_their_class_names() -> void:
	var plugin_script: Script = PluginStoreAdapter
	var fake_script: Script = FakeStoreAdapter
	assert_eq(plugin_script.resource_path, "res://core/payment_core/adapters/plugin_store_adapter.gd")
	assert_eq(fake_script.resource_path, "res://core/payment_core/dev/adapters/fake_store_adapter.gd")
	assert_eq(plugin_script.get_global_name(), &"PluginStoreAdapter")
	assert_eq(fake_script.get_global_name(), &"FakeStoreAdapter")
