package pimobile.wear.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * HTTP client for pi-mobile backend.
 */
class ApiClient(
    baseUrl: String,
    val password: String,
) {
    val baseUrl: String = baseUrl.trimEnd('/')
    @Volatile private var sessionCookie: String? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val original = chain.request()
            val builder = original.newBuilder()
                .addHeader("Accept", "application/json")
                .addHeader("Content-Type", "application/json")
            sessionCookie?.let { builder.addHeader("Cookie", it) }
            chain.proceed(builder.build())
        }
        .build()

    // ---- Auth ----

    suspend fun login(): Result<LoginResponse> = withContext(Dispatchers.IO) {
        try {
            val body = """{"password":"${password.escapeJson()}"}"""
            val request = Request.Builder()
                .url("$baseUrl/api/auth/login")
                .post(body.toRequestBody(JSON))
                .build()

            val response = client.newCall(request).execute()
            val bodyRaw = response.body?.string() ?: throw IllegalStateException("Empty response")

            if (!response.isSuccessful) {
                val msg = parseError(bodyRaw) ?: "Login failed: HTTP ${response.code}"
                return@withContext Result.failure(ApiException(response.code, msg))
            }

            // Extract session cookie
            response.header("Set-Cookie")?.let { cookieHeader ->
                sessionCookie = cookieHeader.split(";").first().trim()
            }

            val loginResponse = moshiAdapter<LoginResponse>().fromJson(bodyRaw)
                ?: throw IllegalStateException("Failed to parse login response")

            return@withContext Result.success(loginResponse)
        } catch (e: Exception) {
            return@withContext Result.failure(
                ApiException(0, e.message ?: "Connection failed: ${e.javaClass.simpleName}")
            )
        }
    }

    suspend fun checkSession(): Result<SessionResponse> = getParsed("/api/auth/session")

    // ---- Agent ----

    suspend fun getMinimalState(): Result<AgentMinimalState> = getParsed("/api/agent/state?minimal=true")

    suspend fun sendPrompt(prompt: String): Result<Unit> {
        val body = """{"prompt":"${prompt.escapeJson()}"}"""
        return postRaw("/api/agent/prompt", body).map { Unit }
    }

    suspend fun abort(): Result<Unit> {
        return postRaw("/api/agent/abort", "{}").map { Unit }
    }

    // ---- Workspace ----

    suspend fun browseWorkspaces(): Result<WorkspaceBrowseResponse> = getParsed("/api/workspaces/browse")

    suspend fun selectRepo(path: String): Result<WorkspaceRepo> {
        val body = """{"path":"${path.escapeJson()}"}"""
        return postParsed("/api/workspaces/select", body)
    }

    // ---- Git ----

    suspend fun commit(message: String): Result<CommitResponse> {
        val body = """{"message":"${message.escapeJson()}"}"""
        return postParsed("/api/git/commit", body)
    }

    // ---- Internal helpers ----

    private suspend fun getRaw(path: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$baseUrl$path")
                .get()
                .build()
            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: throw IllegalStateException("Empty response")
            if (!response.isSuccessful) {
                val msg = parseError(body) ?: "Request failed: HTTP ${response.code}"
                return@withContext Result.failure(ApiException(response.code, msg))
            }
            return@withContext Result.success(body)
        } catch (e: Exception) {
            return@withContext Result.failure(
                ApiException(0, e.message ?: "Request failed: ${e.javaClass.simpleName}")
            )
        }
    }

    private suspend fun postRaw(path: String, jsonBody: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$baseUrl$path")
                .post(jsonBody.toRequestBody(JSON))
                .build()
            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: throw IllegalStateException("Empty response")
            if (!response.isSuccessful) {
                val msg = parseError(body) ?: "Request failed: HTTP ${response.code}"
                return@withContext Result.failure(ApiException(response.code, msg))
            }
            return@withContext Result.success(body)
        } catch (e: Exception) {
            return@withContext Result.failure(
                ApiException(0, e.message ?: "Request failed: ${e.javaClass.simpleName}")
            )
        }
    }

    private suspend inline fun <reified T> getParsed(path: String): Result<T> {
        return getRaw(path).map { body ->
            moshiAdapter<T>().fromJson(body)
                ?: throw IllegalStateException("Failed to parse response")
        }
    }

    private suspend inline fun <reified T> postParsed(path: String, jsonBody: String): Result<T> {
        return postRaw(path, jsonBody).map { body ->
            moshiAdapter<T>().fromJson(body)
                ?: throw IllegalStateException("Failed to parse response")
        }
    }

    private fun parseError(body: String): String? {
        return try {
            moshiAdapter<ApiErrorResponse>().fromJson(body)?.error?.message
        } catch (_: Exception) {
            null
        }
    }

    class ApiException(val httpStatus: Int, override val message: String) : Exception(message)

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}

private inline fun <reified T> moshiAdapter() = Json.moshi.adapter(T::class.java)

/** Minimal JSON string escaping */
private fun String.escapeJson(): String = this
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")
    .replace("\n", "\\n")
    .replace("\r", "\\r")
    .replace("\t", "\\t")
