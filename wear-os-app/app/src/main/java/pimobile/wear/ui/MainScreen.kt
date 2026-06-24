package pimobile.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import android.speech.tts.TextToSpeech
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import pimobile.wear.data.AgentMinimalState
import pimobile.wear.data.ApiClient
import pimobile.wear.data.phaseLabel
import java.util.Locale

@Composable
fun MainScreen(
    apiClient: ApiClient,
    onBack: () -> Unit,
    onVoicePrompt: () -> Unit = {},
) {
    var state by remember { mutableStateOf<AgentMinimalState?>(null) }
    var showFull by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        while (true) {
            apiClient.getMinimalState().onSuccess { state = it }
            delay(3_000)
        }
    }

    // Main content
    Box(
        modifier = Modifier.fillMaxSize()
            .pointerInput(Unit) {
                detectHorizontalDragGestures { _, dragAmount ->
                    if (dragAmount > 80f) onBack()
                }
            }
            .background(Color(0xFF0F172A)),
    ) {
        val agentState = state

        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(4.dp))

            Text("pi", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = Color(0xFFF1F5F9))
            Text(
                agentState?.let { "${it.repoName ?: "—"} · ${it.phaseLabel}" } ?: "…",
                fontSize = 10.sp,
                color = Color(0xFF94A3B8),
            )

            Spacer(Modifier.height(6.dp))

            // Last response – tappable → full overlay
            val preview = agentState?.lastMessagePreview
            Box(
                modifier = Modifier.fillMaxWidth().height(65.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFF1E293B))
                    .clickable(enabled = agentState?.lastMessageFull != null) { showFull = true }
                    .padding(8.dp),
            ) {
                Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    Text(
                        text = preview ?: "— No response yet —",
                        fontSize = 11.sp,
                        lineHeight = 15.sp,
                        color = if (preview != null) Color(0xFFE2E8F0) else Color(0xFF94A3B8),
                    )
                }
            }

            Spacer(Modifier.height(6.dp))

            // Costs
            if (agentState != null) {
                Text(
                    text = "$${"%.6f".format(agentState.usage.totalCost)}",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color(0xFF93C5FD),
                )
                Text(
                    text = "${agentState.usage.totalTokens} tokens · ${agentState.usage.modelId ?: "?"}",
                    fontSize = 8.sp,
                    color = Color(0xFF64748B),
                )
            } else {
                Text("…", fontSize = 10.sp, color = Color(0xFF64748B))
            }

            Spacer(Modifier.height(8.dp))

            val phase = agentState?.runtimePhase ?: "idle"
            val isRunning = phase == "streaming" || phase == "queued" ||
                phase == "compacting" || phase == "retrying" ||
                phase == "bash-running"

            // Voice button (full width, prominent)
            if (isRunning) {
                Button(
                    onClick = { scope.launch { apiClient.abort() } },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD32F2F)),
                ) { Text("⏹ Abort", fontSize = 12.sp) }
            } else {
                Button(
                    onClick = onVoicePrompt,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1565C0)),
                ) { Text("🎤 Voice", fontSize = 14.sp) }
            }

            Spacer(Modifier.height(8.dp))

            // Bottom row: New + Commit (half width each)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = { scope.launch {
                        if (isRunning) apiClient.abort()
                        apiClient.newSession()
                    }},
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                ) {
                    Text("🆕 New", fontSize = 11.sp, textAlign = TextAlign.Center)
                }

                Button(
                    onClick = { scope.launch { apiClient.commit("watch commit") } },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32)),
                ) {
                    Text("Commit", fontSize = 11.sp, textAlign = TextAlign.Center)
                }
            }

            Spacer(Modifier.height(6.dp))

            Button(
                onClick = onBack,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF37474F)),
            ) { Text("Back", fontSize = 11.sp) }

            Spacer(Modifier.height(4.dp))
        }
    }

    // Full response overlay
    if (showFull) {
        val ctx = LocalContext.current
        val fullText = state?.lastMessageFull
        var ttsReady by remember { mutableStateOf(false) }
        var tts by remember { mutableStateOf<TextToSpeech?>(null) }

        DisposableEffect(ctx) {
            val ttsInstance = TextToSpeech(ctx) { status ->
                if (status == TextToSpeech.SUCCESS) ttsReady = true
            }
            tts = ttsInstance
            onDispose { ttsInstance.stop(); ttsInstance.shutdown() }
        }

        Box(
            modifier = Modifier.fillMaxSize()
                .background(Color(0xFF0F172A))
                .clickable { showFull = false }
                .padding(14.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "🔊",
                    fontSize = 24.sp,
                    color = if (ttsReady && fullText != null) Color(0xFF93C5FD) else Color(0xFF475569),
                    modifier = Modifier.clickable(enabled = ttsReady && fullText != null) {
                        fullText?.let {
                            tts?.setLanguage(Locale.US)
                            tts?.speak(it, TextToSpeech.QUEUE_FLUSH, null, null)
                        }
                    },
                )
                Spacer(Modifier.height(4.dp))
                Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                    Text(
                        text = fullText ?: "(empty)",
                        fontSize = 13.sp,
                        lineHeight = 18.sp,
                        color = Color(0xFFE2E8F0),
                    )
                }
            }
        }
    }
}
