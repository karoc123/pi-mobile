package pimobile.wear.data

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory

/** Slim version of the backend's AgentMinimalState */
data class AgentMinimalState(
    val repoName: String?,
    val runtimePhase: String,
    val pendingMessageCount: Int,
    val lastError: String?,
    val lastMessagePreview: String?,
    val lastMessageFull: String?,
    val usage: UsageSummary,
)

data class UsageSummary(
    val totalCost: Double,
    val totalTokens: Int,
    val modelId: String?,
)

/** Response from POST /api/auth/login */
data class LoginResponse(
    val authenticated: Boolean,
    val repo: RepoInfo?,
)

data class RepoInfo(
    val name: String?,
    val relativePath: String?,
)

/** Session check response */
data class SessionResponse(
    val authenticated: Boolean,
    val repo: RepoInfo?,
)

/** Commit */
data class CommitRequest(val message: String)

data class CommitResponse(val commitSha: String)

/** Workspace */
data class WorkspaceEntry(
    val name: String,
    val relativePath: String,
    val kind: String,
    val isGitRepo: Boolean,
)

data class WorkspaceBrowseResponse(
    val currentPath: String,
    val entries: List<WorkspaceEntry>,
    val currentRepo: WorkspaceRepo?,
)

data class WorkspaceRepo(
    val name: String,
    val relativePath: String,
    val absolutePath: String?,
)

/** Wrapper for /api/workspaces/select response: { repo: { name, relativePath, absolutePath } } */
data class SelectRepoResponse(val repo: WorkspaceRepo)

/** Generic ok */
data class OkResponse(val ok: Boolean)

/** API error */
data class ApiErrorResponse(
    val ok: Boolean,
    val error: ApiErrorDetail,
)

data class ApiErrorDetail(
    val code: String,
    val message: String,
    val requestId: String,
    val retriable: Boolean,
)

// ---- Display helpers ----

val AgentMinimalState.phaseLabel: String
    get() = when (runtimePhase) {
        "idle" -> "● Idle"
        "streaming" -> "▶ Streaming"
        "queued" -> "⏳ Queued"
        "compacting" -> "⚙ Compacting"
        "retrying" -> "↻ Retrying"
        "bash-running" -> "⌨ Bash"
        else -> "● $runtimePhase"
    }

val AgentMinimalState.phaseColor: Long
    get() = when (runtimePhase) {
        "idle" -> 0xFF4CAF50L
        "streaming" -> 0xFF2196F3L
        "queued" -> 0xFFFF9800L
        "compacting" -> 0xFF9C27B0L
        "retrying" -> 0xFFFF5722L
        "bash-running" -> 0xFF795548L
        else -> 0xFF9E9E9EL
    }

object Json {
    val moshi: Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()
}
