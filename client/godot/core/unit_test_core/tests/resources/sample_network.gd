extends UnitTestCase
## Sample test file of the nested runs: a request without a registered result.


func test_request_without_result() -> void:
	var result: NetworkTransportResult = await UnitTestCore._run.network.send(1, "http://127.0.0.1/core/Missing", PackedStringArray(), PackedByteArray())
	assert_eq(result.transfer, NetworkCore.TransferResult.CONNECTION_FAILED)
	assert_eq(result.handle, 1)
