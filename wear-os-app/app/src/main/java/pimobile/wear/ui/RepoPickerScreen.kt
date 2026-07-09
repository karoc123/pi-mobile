package pimobile.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pimobile.wear.data.ApiClient
import pimobile.wear.data.WorkspaceEntry

@Composable
fun RepoPickerScreen(
    apiClient: ApiClient,
    onRepoSelected: (repoPath: String, repoName: String) -> Unit,
    onBackToSettings: () -> Unit = {},
) {
    var entries by remember { mutableStateOf<List<WorkspaceEntry>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var selecting by remember { mutableStateOf<String?>(null) } // name of repo being selected
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        try {
            loading = true
            apiClient.browseWorkspaces()
                .onSuccess { resp ->
                    entries = resp.entries.filter { it.isGitRepo }
                    loading = false
                }
                .onFailure { e ->
                    error = "${e.message ?: e.javaClass.simpleName}"
                    loading = false
                }
        } catch (e: Exception) {
            error = "${e.message ?: e.javaClass.simpleName}"
            loading = false
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Repository wählen", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

        when {
            loading -> {
                Spacer(Modifier.height(24.dp))
                Text("Lade…", fontSize = 16.sp, color = Color(0xFF93C5FD))
            }

            error != null -> {
                Spacer(Modifier.height(8.dp))
                Text("⚠ $error", fontSize = 12.sp, color = Color(0xFFFF5252), textAlign = TextAlign.Center)
                Spacer(Modifier.height(8.dp))
                Button(onClick = {
                    scope.launch { loading = true; error = null
                        try { apiClient.browseWorkspaces().onSuccess { entries = it.entries.filter { e -> e.isGitRepo } }.onFailure { e -> error = e.message } } catch (e: Exception) { error = e.message }
                        loading = false
                    }
                }, modifier = Modifier.fillMaxWidth()) { Text("Retry", fontSize = 12.sp) }
                Spacer(Modifier.height(4.dp))
                Button(onClick = onBackToSettings, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF37474F))) { Text("Back", fontSize = 12.sp) }
            }

            entries.isEmpty() -> {
                Spacer(Modifier.height(24.dp))
                Text("Keine Git-Repos", fontSize = 14.sp, color = Color.Gray)
                Spacer(Modifier.height(8.dp))
                Button(onClick = onBackToSettings, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF37474F))) { Text("Back", fontSize = 12.sp) }
            }

            else -> {
                Spacer(Modifier.height(6.dp))
                entries.forEach { entry ->
                    val isSelected = selecting == entry.name
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (isSelected) Color(0xFF1E3A5F) else Color(0xFF1E293B))
                            .clickable(enabled = !isSelected) {
                                selecting = entry.name
                                scope.launch {
                                    try {
                                        apiClient.selectRepo(entry.relativePath)
                                            .onSuccess {
                                                onRepoSelected(entry.relativePath, entry.name)
                                            }
                                            .onFailure { e -> error = e.message; selecting = null }
                                    } catch (e: Exception) { error = e.message; selecting = null }
                                }
                            }
                            .padding(horizontal = 12.dp, vertical = 12.dp),
                    ) {
                        Text(
                            text = "📁 ${entry.name}",
                            fontSize = 15.sp,
                            color = Color(0xFFF1F5F9),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                }
                Spacer(Modifier.height(6.dp))
                Button(onClick = onBackToSettings, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF37474F))) { Text("Back", fontSize = 12.sp) }
            }
        }
    }
}
