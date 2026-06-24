package pimobile.wear

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import pimobile.wear.data.ApiClient
import pimobile.wear.ui.MainScreen
import pimobile.wear.ui.RepoPickerScreen
import pimobile.wear.ui.SettingsScreen
import pimobile.wear.ui.theme.PiMobileTheme
import java.util.*

private val Activity.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class MainActivity : ComponentActivity() {
    @Volatile private var apiClient: ApiClient? = null

    private val voiceLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val prompt = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
            if (prompt != null && apiClient != null) {
                CoroutineScope(Dispatchers.IO).launch { apiClient!!.sendPrompt(prompt) }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PiMobileTheme {
                var screen by remember { mutableStateOf<String?>(null) } // null = loading
                var savedUrl by remember { mutableStateOf("") }
                var savedPassword by remember { mutableStateOf("") }

                // Load DataStore ONCE before showing UI
                LaunchedEffect(Unit) {
                    val prefs = dataStore.data.first()
                    savedUrl = prefs[stringPreferencesKey("url")] ?: ""
                    savedPassword = prefs[stringPreferencesKey("password")] ?: ""
                    screen = "settings"
                }

                when (screen) {
                    null -> {
                        // Loading / black screen
                        Box(Modifier.fillMaxSize().background(Color(0xFF0F172A)))
                    }
                    "settings" -> {
                        SettingsScreen(
                            initialUrl = savedUrl,
                            initialPassword = savedPassword,
                            onConnect = { url, pw ->
                                // Called from coroutine, runs on Dispatchers.IO internally
                                val client = ApiClient(url, pw)
                                val result = client.login()
                                if (result.isSuccess) {
                                    apiClient = client
                                    CoroutineScope(Dispatchers.IO).launch {
                                        dataStore.edit { prefs ->
                                            prefs[stringPreferencesKey("url")] = client.baseUrl
                                            prefs[stringPreferencesKey("password")] = client.password
                                        }
                                    }
                                }
                                result
                            },
                            onConnected = {
                                // Login succeeded -> go to repo picker
                                screen = "repo_picker"
                            },
                            onBack = { finish() },
                        )
                    }
                    "repo_picker" -> {
                        apiClient?.let { client ->
                            RepoPickerScreen(
                                apiClient = client,
                                onRepoSelected = { screen = "main" },
                                onBackToSettings = { screen = "settings" },
                            )
                        } ?: Box(Modifier.fillMaxSize().background(Color(0xFF0F172A))) // should never happen
                    }
                    "main" -> {
                        apiClient?.let { client ->
                            MainScreen(
                                apiClient = client,
                                onBack = { screen = "repo_picker" },
                                onVoicePrompt = { startVoiceRecognition() },
                            )
                        } ?: Box(Modifier.fillMaxSize().background(Color(0xFF0F172A))) // safety
                    }
                }
            }
        }
    }

    private fun startVoiceRecognition() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PROMPT, "What do you want pi to do?")
        }
        voiceLauncher.launch(intent)
    }
}
