class_name DeletionCodeResult
extends RefCounted
## Result of `AuthCore.issue_deletion_code`.

## True when the code was issued.
var ok: bool = false
## Code to type on the web account deletion page. Empty on failure.
var code: String = ""
## Time the code expires. Unix ms. 0 on failure.
var expires_at: int = 0
## Address of the web account deletion page. Empty on failure.
var url: String = ""
