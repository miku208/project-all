import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Signing release: baca keystore.properties (di-gitignore). Kalau file/keystore
// tidak ada, fallback ke unsigned debug-signing supaya build dev tetap jalan.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) FileInputStream(f).use { load(it) }
}
val hasReleaseSigning = keystoreProps.getProperty("mikuwa.release.password") != null &&
    rootProject.file("mikuwa-release.keystore").exists()

android {
    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = rootProject.file("mikuwa-release.keystore")
                storePassword = keystoreProps.getProperty("mikuwa.release.password")
                keyAlias = "mikuwa"
                keyPassword = keystoreProps.getProperty("mikuwa.release.password")
            }
        }
    }
    namespace = "id.miku.waclient"
    compileSdk = 34

    defaultConfig {
        applicationId = "id.miku.waclient"
        minSdk = 26
        targetSdk = 34
        versionCode = 20
        versionName = "0.9.9"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = if (hasReleaseSigning) signingConfigs.getByName("release")
                else signingConfigs.getByName("debug")
        }
    }
    buildFeatures { compose = true }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.05.00"))
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // MediaStyle notification (tampilan player gaya Spotify di tray notifikasi)
    implementation("androidx.media:media:1.7.0")
}
