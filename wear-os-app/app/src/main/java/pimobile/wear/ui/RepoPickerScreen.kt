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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pimobile.wear.data.ApiClient
import pimobile.wear.data.WorkspaceEntry

@Composable
fun RepoPickerScreen(
    apiClient: ApiClient,
    onRepoSelected: () -> Unit,
) {
    var entries by remember { mutableStateOf<List<WorkspaceEntry>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var selecting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        loading = true
        apiClient.browseWorkspaces()
            .onSuccess { resp -> entries = resp.entries.filter { it.isGitRepo } }
            .onFailure { e -> error = e.message }
        loading = false
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Select Repository", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))

        when {
            loading -> Text("Loading…", fontSize = 12.sp, color = Color.Gray)
            error != null -> {
                Text("⚠ ${error}", fontSize = 10.sp, color = Color(0xFFFF5252))
                Spacer(Modifier.height(6.dp))
                Button(onClick = {
                    scope.launch {
                        loading = true; error = null
                        apiClient.browseWorkspaces()
                            .onSuccess { entries = it.entries.filter { e -> e.isGitRepo } }
                            .onFailure { e -> error = e.message }
                        loading = false
                    }
                }) { Text("Retry") }
            }
            entries.isEmpty() -> Text("No Git repos found", fontSize = 12.sp, color = Color.Gray)
            else -> {
                entries.forEach { entry ->
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !selecting) {
                                selecting = true
                                scope.launch {
                                    apiClient.selectRepo(entry.relativePath)
                                        .onSuccess { selecting = false; onRepoSelected() }
                                        .onFailure { e -> error = e.message; selecting = false }
                                }
                            }
                            .padding(vertical = 8.dp, horizontal = 4.dp),
                    ) {
                        Text(
                            text = entry.name,
                            style = MaterialTheme.typography.bodyLarge,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Box(Modifier.fillMaxWidth().height(0.5.dp).background(Color(0xFF334155)))
                }
            }
        }

        Spacer(Modifier.height(6.dp))
        if (selecting) Text("Selecting…", fontSize = 10.sp, color = Color.Gray)
    }
}
