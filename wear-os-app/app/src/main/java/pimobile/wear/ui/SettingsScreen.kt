package pimobile.wear.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pimobile.wear.data.LoginResponse

@Composable
fun SettingsScreen(
    initialUrl: String,
    initialPassword: String,
    onConnect: suspend (url: String, password: String) -> Result<LoginResponse>,
    onConnected: () -> Unit,
    onBack: () -> Unit,
) {
    var url by remember { mutableStateOf(initialUrl) }
    var password by remember { mutableStateOf(initialPassword) }
    var status by remember { mutableStateOf<String?>(null) }
    var isConnecting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // Sync from DataStore when initial values change
    LaunchedEffect(initialUrl) { url = initialUrl }
    LaunchedEffect(initialPassword) { password = initialPassword }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("pi", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))

        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("Server URL", fontSize = 10.sp) },
            placeholder = { Text("http://192.168.1.x:3000", fontSize = 10.sp) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            textStyle = MaterialTheme.typography.bodySmall,
        )

        Spacer(Modifier.height(8.dp))

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password", fontSize = 10.sp) },
            placeholder = { Text("APP_PASSWORD", fontSize = 10.sp) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            textStyle = MaterialTheme.typography.bodySmall,
        )

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = {
                if (url.isBlank() || password.isBlank()) { status = "URL + password required"; return@Button }
                isConnecting = true; status = "Connecting…"
                scope.launch {
                    val result = withContext(Dispatchers.IO) {
                        onConnect(url.trim(), password.trim())
                    }
                    result
                        .onSuccess {
                            status = "✓ Connected"
                            isConnecting = false
                            onConnected()
                        }
                        .onFailure { e ->
                            status = "✗ ${e.message ?: e.javaClass.simpleName}"
                            isConnecting = false
                        }
                }
            },
            enabled = !isConnecting,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (isConnecting) "Connecting…" else "Connect", fontSize = 12.sp) }

        status?.let { msg ->
            Spacer(Modifier.height(4.dp))
            Text(msg, fontSize = 10.sp, color = if (msg.startsWith("✓")) Color(0xFF4CAF50) else Color(0xFFFF5252), textAlign = TextAlign.Center)

            if (!msg.startsWith("✓")) {
                Spacer(Modifier.height(8.dp))
                Button(onClick = { status = null; isConnecting = false },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF37474F))) {
                    Text("Retry", fontSize = 11.sp)
                }
                Spacer(Modifier.height(4.dp))
                Button(onClick = onBack,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF37474F))) {
                    Text("Back", fontSize = 11.sp)
                }
            }
        }

        if (status == null || status?.startsWith("✓") == true) {
            Spacer(Modifier.height(12.dp))
            Button(onClick = onBack,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF37474F))) {
                Text("Back", fontSize = 12.sp)
            }
        }
    }
}
