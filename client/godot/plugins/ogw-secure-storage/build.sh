#!/bin/sh
# Builds `dist/<platform>/` of the `ogw-secure-storage` plugin for the platforms of this host:
#   ./build.sh <work folder>
# - Mac host: android, ios and macos. Needs Xcode, SCons, JDK 17 (`JAVA_HOME`) and the Android SDK (`ANDROID_HOME`)
# - Linux host: the linux library of this host's architecture (x86_64 or arm64). Each architecture that the
#   `.gdextension` names is built on a Linux host of that architecture. Needs g++, SCons, pkg-config and the libsecret
#   headers (`libsecret-1-dev`). The glibc of the host sets the lowest Linux the library runs on
# - Windows host: windows x86_64, from the MSYS2 MINGW64 shell. Needs SCons and MinGW-w64 g++
#   (`mingw-w64-x86_64-gcc`), whose static runtime libraries the license manifest lists
# The work folder gets the godot-cpp checkout below once, and on a Mac host the Godot source.
# A build replaces only what it builds in `dist/`: the dists of the other hosts stay.
set -eu

GODOT_TAG="4.7.2-stable"
GODOT_CPP_COMMIT="2bb1acf6f8ae1ce96ac7b9ba3a10b499c59c49ec"
# Defines of the official iOS export templates that the engine headers this plugin includes depend on.
IOS_DEFINES="IOS_ENABLED APPLE_EMBEDDED_ENABLED UNIX_ENABLED COREAUDIO_ENABLED THREADS_ENABLED MINIZIP_ENABLED BROTLI_ENABLED"

if [ "$#" -ne 1 ]; then
	echo "usage: $0 <work folder>" >&2
	exit 2
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$1"
WORK="$(cd "$1" && pwd)"
GODOT="$WORK/godot"
GODOT_CPP="$WORK/godot-cpp"
# Source paths compiled into the libraries (`__FILE__`) start with `.` instead of the folders of this host.
PREFIX_MAPS="$WORK=.;$HERE=."
DIST="$HERE/dist"
ADDON="addons/ogw-secure-storage"

if [ ! -d "$GODOT_CPP" ]; then
	git clone --quiet https://github.com/godotengine/godot-cpp "$GODOT_CPP"
fi
git -C "$GODOT_CPP" checkout --quiet "$GODOT_CPP_COMMIT"

# The `.gdextension` and the library of one desktop platform under `dist/<platform>/`.
desktop_dist() {
	mkdir -p "$DIST/$1/$ADDON/$1"
	cp "$HERE/ogw-secure-storage.gdextension" "$DIST/$1/$ADDON/"
	cp "$2" "$DIST/$1/$ADDON/$1/"
}

# windows and linux: GDExtension library of `desktop/`, built from a copy of the sources and godot-cpp so that the
# object files of another platform or architecture in the work folder are not reused.
desktop_copy() {
	rm -rf "$WORK/$1"
	mkdir -p "$WORK/$1/desktop"
	cp -R "$GODOT_CPP" "$WORK/$1/godot-cpp"
	cp -R "$HERE/desktop/SConstruct" "$HERE/desktop/src" "$WORK/$1/desktop/"
}

case "$(uname -s)" in
Darwin)
	if [ ! -d "$GODOT" ]; then
		git clone --quiet --depth 1 --branch "$GODOT_TAG" https://github.com/godotengine/godot "$GODOT"
	fi
	# Generated engine headers that the iOS plugin includes.
	(cd "$GODOT" && scons platform=ios target=template_release arch=arm64 \
		core/extension/gdextension_interface.gen.h core/version_generated.gen.h core/disabled_classes.gen.h \
		core/object/gdvirtual.gen.h > /dev/null)

	# android: Godot Android plugin v2 AAR and its export plugin.
	rm -rf "$DIST/android"
	(cd "$HERE/android" && ./gradlew --quiet assembleRelease)
	ANDROID_OUT="$DIST/android/$ADDON"
	mkdir -p "$ANDROID_OUT/android"
	cp "$HERE/android/addon/plugin.cfg" "$HERE/android/addon/ogw_secure_storage_export.gd" "$ANDROID_OUT/"
	cp "$HERE/android/plugin/build/outputs/aar/plugin-release.aar" "$ANDROID_OUT/android/ogw-secure-storage-release.aar"

	# macos: GDExtension library.
	rm -rf "$DIST/macos"
	(cd "$HERE/macos" && scons --quiet platform=macos target=template_release arch=universal godot_cpp="$GODOT_CPP" file_prefix_maps="$PREFIX_MAPS")
	desktop_dist macos "$HERE/macos/bin/libogw-secure-storage.macos.dylib"

	# ios: static library per engine build type (`debug` has `DEBUG_ENABLED`), each an xcframework of device and simulator.
	IOS_WORK="$WORK/ios-build"
	rm -rf "$IOS_WORK" "$DIST/ios"
	IOS_OUT="$DIST/ios/ios/plugins/ogw-secure-storage"
	mkdir -p "$IOS_OUT"
	cp "$HERE/ios/ogw-secure-storage.gdip" "$IOS_OUT/"
	for build in debug release; do
		if [ "$build" = "debug" ]; then configuration="Debug"; else configuration="Release"; fi
		for sdk in ios simulator; do
			if [ "$sdk" = "ios" ]; then
				destination="generic/platform=iOS"
				defines="$IOS_DEFINES"
			else
				destination="generic/platform=iOS Simulator"
				defines="$IOS_DEFINES IOS_SIMULATOR"
			fi
			xcodebuild archive -quiet -project "$HERE/ios/ogw-secure-storage.xcodeproj" -scheme ogw-secure-storage \
				-configuration "$configuration" -destination "$destination" \
				-archivePath "$IOS_WORK/$build-$sdk.xcarchive" -derivedDataPath "$IOS_WORK/derived" \
				GODOT_SOURCE_DIR="$GODOT" GODOT_DEFINES="$defines" OTHER_CFLAGS="-ffile-prefix-map=$WORK=. -ffile-prefix-map=$HERE=."
		done
		xcodebuild -create-xcframework \
			-library "$IOS_WORK/$build-ios.xcarchive/Products/Library/libogw-secure-storage.a" \
			-library "$IOS_WORK/$build-simulator.xcarchive/Products/Library/libogw-secure-storage.a" \
			-output "$IOS_OUT/ogw-secure-storage.$build.xcframework" > /dev/null
	done
	;;
Linux)
	case "$(uname -m)" in
	x86_64) arch="x86_64" ;;
	aarch64 | arm64) arch="arm64" ;;
	*)
		echo "no linux library is built for the architecture $(uname -m)" >&2
		exit 1
		;;
	esac
	desktop_copy "linux-$arch"
	(cd "$WORK/linux-$arch/desktop" && scons --quiet -j"$(nproc)" platform=linux arch="$arch" target=template_release \
		godot_cpp="$WORK/linux-$arch/godot-cpp" file_prefix_maps="$WORK/linux-$arch=.")
	rm -f "$DIST/linux/$ADDON/linux/libogw-secure-storage.linux.$arch.so"
	desktop_dist linux "$WORK/linux-$arch/desktop/bin/libogw-secure-storage.linux.$arch.so"
	;;
MINGW64_NT*)
	desktop_copy windows-x86_64
	(cd "$WORK/windows-x86_64/desktop" && scons --quiet platform=windows arch=x86_64 use_mingw=yes target=template_release \
		godot_cpp="$WORK/windows-x86_64/godot-cpp" file_prefix_maps="$WORK/windows-x86_64=.")
	rm -rf "$DIST/windows"
	desktop_dist windows "$WORK/windows-x86_64/desktop/bin/libogw-secure-storage.windows.x86_64.dll"
	;;
*)
	echo "this host builds no platform of the plugin: run it on a Mac host, a Linux host, or the MSYS2 MINGW64 shell of a Windows host" >&2
	exit 1
	;;
esac
