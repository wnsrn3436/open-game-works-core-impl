extends RefCounted
## Outcomes of the steps of a purchase and a transaction processing.

## Verify result of a `VerifyPurchase` or `RecoverPurchase`.
enum Verify { GRANTED, ALREADY_GRANTED, INVALID, OTHER_USER, PENDING, FAILED }
## End of one transaction processing.
enum Processed { COUNTED, SKIPPED, DISCARDED }
