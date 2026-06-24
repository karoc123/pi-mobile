package pimobile.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import pimobile.wear.data.AgentMinimalState
import pimobile.wear.data.ApiClient

@Composable
fun MainScreen(
    apiClient: ApiClient,
    onSettingsClick: () -> Unit,
    onVoicePrompt: () -> Unit = {},
) {
    var state by remember { mutableStateOf<AgentMinimalState?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        while (true) {
            apiClient.getMinimalState().onSuccess { state = it }
            delay(3_000)
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("pi", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(state?.repoName ?: "—", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
        Spacer(Modifier.height(8.dp))

        Text("Phase: ${state?.runtimePhase ?: "?"}", fontSize = 11.sp)
        Text("Cost: $${"%.4f".format(state?.usage?.totalCost ?: 0.0)}", fontSize = 9.sp, color = Color.Gray)
        Spacer(Modifier.height(12.dp))

        Button(onClick = { scope.launch { apiClient.abort() } }, modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD32F2F))) { Text("Abort") }
        Spacer(Modifier.height(6.dp))
        Button(onClick = { scope.launch { apiClient.commit("watch commit") } }, modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))) { Text("Commit") }
        Spacer(Modifier.height(6.dp))
        Button(onClick = onVoicePrompt, modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1565C0))) { Text("Voice") }
        Spacer(Modifier.height(6.dp))
        Button(onClick = onSettingsClick, modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF37474F))) { Text("Settings") }
    }
}
