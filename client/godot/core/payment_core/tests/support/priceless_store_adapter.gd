extends FakeStoreAdapter
## Fake store adapter whose `query_prices` succeeds but gives an empty price to the SKUs in `priceless`.

var priceless: PackedStringArray = PackedStringArray()


func query_prices(skus: PackedStringArray) -> PriceResult:
	var result: PriceResult = await super.query_prices(skus)
	for i: int in result.prices.size():
		if skus[i] in priceless:
			result.prices[i] = ""
	return result
