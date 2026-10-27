// Godot Android plugin v2 `OgwSecureStorage`. `./gradlew assembleRelease` writes `build/outputs/aar/plugin-release.aar`.
// It uses only the Android platform, so the export plugin lists no other library.
plugins {
    id("com.android.library")
}

android {
    namespace = "io.github.wnsrn3436.ogw.securestorage"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    compileOnly("org.godotengine:godot:4.7.2.stable")
}
