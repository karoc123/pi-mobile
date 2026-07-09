package pimobile.wear.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val PiColorScheme = darkColorScheme(
    primary = Color(0xFF93C5FD),
    secondary = Color(0xFF22D3EE),
    tertiary = Color(0xFF38BDF8),
    background = Color(0xFF0F172A),
    surface = Color(0xFF1E293B),
    onPrimary = Color(0xFF0F172A),
    onSecondary = Color(0xFF0F172A),
    onBackground = Color(0xFFF1F5F9),
    onSurface = Color(0xFFF1F5F9),
    error = Color(0xFFFF5252),
    onError = Color(0xFFFFFFFF),
)

@Composable
fun PiMobileTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = PiColorScheme,
        content = content,
    )
}
