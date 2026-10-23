class_name DownloadedBundle
extends RefCounted
## A downloaded bundle file `ResourceCore.apply_bundles` attaches. `GameUpdateCore` makes it.

## Bundle name. snake_case.
var name: String = ""
## Path of the bundle file under the app storage root.
var path: String = ""
## SHA-256 of the bundle file as 64 lowercase hex digits.
var sha256: String = ""
