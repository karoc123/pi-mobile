plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "pimobile.wear"
    compileSdk = 35

    defaultConfig {
        applicationId = "pimobile.wear"
        minSdk = 30  // WearOS 3 (Galaxy Watch 4+)
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    // Compose (phone Material3 – works on WearOS, wear-specific M3 conflicts)
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")

    // Activity & Lifecycle
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")

    // DataStore for persisting URL + password
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // HTTP client (OkHttp)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // JSON parsing (org.json is built-in, but moshi is nicer)
    implementation("com.squareup.moshi:moshi-kotlin:1.15.2")

    // WearOS tiles / complications (optional)
    implementation("androidx.wear:wear-ongoing:1.0.0")
    implementation("androidx.wear:wear-phone-interactions:1.1.0")
}
