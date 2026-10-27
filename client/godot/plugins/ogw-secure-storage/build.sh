#!/bin/sh
# Builds `dist/<platform>/` of the `ogw-secure-storage` plugin for android, ios, macos, windows and linux on a Mac host:
#   ./build.sh <work folder>
# Needs Xcode, SCons, JDK 17 (`JAVA_HOME`), the Android SDK (`ANDROID_HOME`), MinGW-w64 (`x86_64-w64-mingw32-g++`) for
# windows, whose static runtime libraries the license manifest lists, and Docker for linux: each architecture that the
# `.gdextension` names is built in a `debian:bullseye` container of that architecture, whose glibc sets the lowest Linux
# the library runs on.
# The work folder gets the Godot source and godot-cpp checkouts below once.
set -eu

GODOT_TAG="4.7.2-stable"
GODOT_CPP_COMMIT="2bb1acf6f8ae1ce96ac7b9ba3a10b499c59c49ec"
# Defines of the official iOS export templates that the engine headers this plugin includes depend on.
IOS_DEFINES="IOS_ENABLED APPLE_EMBEDDED_ENABLED UNIX_ENABLED COREAUDIO_ENABLED THREADS_ENABLED MINIZIP_ENABLED BROTLI_ENABLED"
LINUX_IMAGE="debian:bullseye"
# Debian 11 packages moved to the Debian archive.
LINUX_SOURCES="deb http://archive.debian.org/debian bullseye main\ndeb http://archive.debian.org/debian-security bullseye-security main"

if [ "$#" -ne 1 ]; then
	echo "usage: $0 <work folder>" >&2
	exit 2
fi
if [ "$(uname -s)" != "Darwin" ]; then
	echo "the plugin is built on a Mac host" >&2
	exit 1
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

# windows: x86_64 with the MinGW-w64 cross compiler.
desktop_copy windows-x86_64
(cd "$WORK/windows-x86_64/desktop" && scons --quiet platform=windows arch=x86_64 use_mingw=yes target=template_release \
	godot_cpp="$WORK/windows-x86_64/godot-cpp" file_prefix_maps="$WORK/windows-x86_64=.")
rm -rf "$DIST/windows"
desktop_dist windows "$WORK/windows-x86_64/desktop/bin/libogw-secure-storage.windows.x86_64.dll"

# linux: each architecture in a container of that architecture.
rm -rf "$DIST/linux"
for arch in x86_64 arm64; do
	if [ "$arch" = "x86_64" ]; then docker_platform="linux/amd64"; else docker_platform="linux/arm64"; fi
	desktop_copy "linux-$arch"
	docker run --rm --platform "$docker_platform" -v "$WORK/linux-$arch:/work" "$LINUX_IMAGE" sh -c "
		printf '$LINUX_SOURCES\n' > /etc/apt/sources.list &&
		apt-get update -qq > /dev/null &&
		DEBIAN_FRONTEND=noninteractive apt-get install -y -qq g++ python3-pip pkg-config libsecret-1-dev > /dev/null 2>&1 &&
		pip3 install --quiet scons==4.8.1 &&
		cd /work/desktop &&
		scons --quiet -j\$(nproc) platform=linux arch=$arch target=template_release godot_cpp=/work/godot-cpp file_prefix_maps=/work=."
	desktop_dist linux "$WORK/linux-$arch/desktop/bin/libogw-secure-storage.linux.$arch.so"
done
