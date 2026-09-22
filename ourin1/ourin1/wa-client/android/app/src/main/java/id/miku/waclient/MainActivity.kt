package id.miku.waclient

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ThumbnailUtils
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import id.miku.waclient.data.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// ===== Tema gelap bersih (tanpa glow/neon/gradient berlebihan) =====
val Bg = Color(0xFF101418)
val Panel = Color(0xFF171D23)
val Panel2 = Color(0xFF1D242C)
val Border = Color(0xFF2A333D)
val TextMain = Color(0xFFE6EAEE)
val TextMuted = Color(0xFF8A97A5)
val Accent = Color(0xFF3D8BFD)
val BubbleMe = Color(0xFF1F3A5F)

/**
 * Player musik GLOBAL (singleton) — musik TETAP JALAN saat user pindah tab
 * (Chats/Contacts/Settings) atau buka chat. State player & hasil pencarian
 * disimpan di sini, bukan di composable (yang di-dispose saat pindah tab).
 * Prinsip tetap STREAMING: tidak ada file yang diunduh ke storage HP.
 */
object MusicPlayer {
    var nowPlaying by mutableStateOf<YtVideo?>(null)
        private set
    var playFormat by mutableStateOf<String?>(null) // "mp3" | "mp4"
        private set
    var preparing by mutableStateOf(false)
        private set
    var isPaused by mutableStateOf(false)
        private set
    var positionSec by mutableStateOf(0)
        private set
    var durationSec by mutableStateOf(0)
        private set

    // Hasil pencarian juga global — tidak hilang saat pindah tab
    var lastQuery by mutableStateOf("")
    var results by mutableStateOf<List<YtVideo>>(emptyList())
    var searched by mutableStateOf(false)

    // ===== ANTREAN LAGU =====
    // queue + queueIndex: lagu yang sedang & akan diputar; autoNext: lanjut
    // sendiri saat lagu habis. nowArtist & currentArt dipakai notifikasi
    // MediaStyle (gaya Spotify) di tray notifikasi & layar kunci.
    var queue by mutableStateOf<List<YtVideo>>(emptyList())
        private set
    var queueIndex by mutableStateOf(-1)
        private set
    var autoNext by mutableStateOf(true)
    var nowArtist by mutableStateOf("")
        private set
    var currentArt by mutableStateOf<android.graphics.Bitmap?>(null)
        private set

    private var player: android.media.MediaPlayer? = null
    private var lastClient: GatewayClient? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    // Context app: dipakai untuk start/stop foreground service. Foreground
    // service inilah yang menjaga proses & CPU tetap hidup saat user pindah
    // tab, buka app lain, atau layar mati — musik tidak lagi ikut berhenti.
    private var appCtx: android.content.Context? = null

    // Partial wake lock: layar boleh mati, CPU tetap jalan (playback).
    private var wakeLock: android.os.PowerManager.WakeLock? = null

    // Ticker 500ms: update posisi (progress bar) dari player aktif.
    private var ticker: kotlinx.coroutines.Job? = null

    private fun acquireWakeLock(ctx: android.content.Context) {
        if (wakeLock != null) return
        runCatching {
            val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
            wakeLock = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "MikuWA:MusicPlayback").apply {
                setReferenceCounted(false)
                acquire(4 * 60 * 60 * 1000L) // maks 4 jam, fail-safe
            }
        }
    }

    private fun releaseWakeLock() {
        runCatching {
            wakeLock?.let { if (it.isHeld) it.release() }
        }
        wakeLock = null
    }

    private fun startTicker() {
        ticker?.cancel()
        ticker = scope.launch {
            while (true) {
                player?.let { mp ->
                    runCatching {
                        if (mp.isPlaying) positionSec = mp.currentPosition / 1000
                        if (durationSec <= 0 && mp.duration > 0) durationSec = mp.duration / 1000
                    }
                }
                kotlinx.coroutines.delay(500)
            }
        }
    }

    /** Seek ke posisi detik (public — dipakai slider progress). */
    fun seekTo(sec: Int) {
        runCatching {
            player?.seekTo(sec * 1000)
            positionSec = sec
        }
    }

    fun seekToStart() = seekTo(0)

    fun stop() = stopInternal(clearQueue = true)

    private fun stopInternal(clearQueue: Boolean) {
        ticker?.cancel(); ticker = null
        player?.let { runCatching { it.stop(); it.release() } }
        player = null
        isPaused = false
        nowPlaying = null
        playFormat = null
        positionSec = 0
        durationSec = 0
        currentArt = null
        if (clearQueue) {
            queue = emptyList()
            queueIndex = -1
        }
        releaseWakeLock()
        appCtx?.let { ctx -> runCatching { MusicService.stop(ctx) } }
    }

    fun pauseResume() {
        if (isPaused) resume() else pause()
    }

    fun resume() {
        player?.let { mp ->
            if (isPaused) {
                mp.start()
                isPaused = false
                MusicService.refreshStatic(appCtx)
            }
        }
    }

    fun pause() {
        player?.let { mp ->
            if (!isPaused) {
                mp.pause()
                isPaused = true
                MusicService.refreshStatic(appCtx)
            }
        }
    }

    // ===== ANTREAN LAGU =====

    /** Putar `video` dan jadikan `list` antrean aktif (mulai dari posisi video). */
    fun playFromQueue(client: GatewayClient, video: YtVideo, list: List<YtVideo>, appContext: Context) {
        val idx = list.indexOfFirst { it.videoId == video.videoId }.takeIf { it >= 0 } ?: 0
        // stopInternal di streamAudio TIDAK menghapus antrean — set setelahnya
        streamAudio(client, video, appContext)
        queue = list
        queueIndex = idx
    }

    fun hasNext(): Boolean = queueIndex >= 0 && queueIndex < queue.size - 1

    fun hasPrev(): Boolean = queueIndex >= 0

    fun playNext() {
        if (!hasNext()) return
        val client = lastClient ?: return
        val ctx = appCtx ?: return
        val next = queue[queueIndex + 1]
        queueIndex += 1
        streamAudio(client, next, ctx)
    }

    /** Spotify-style: kalau sudah play > 3 detik, ⏮ = restart lagu sekarang. */
    fun playPrevious() {
        if (queueIndex < 0) return
        if (positionSec > 3) {
            seekTo(0)
            return
        }
        if (queueIndex > 0) {
            val client = lastClient ?: return
            val ctx = appCtx ?: return
            queueIndex -= 1
            streamAudio(client, queue[queueIndex], ctx)
        } else {
            seekTo(0)
        }
    }

    /** Dipanggil saat lagu selesai: lanjut antrean (auto-next) atau berhenti. */
    fun onTrackEnded() {
        if (autoNext && hasNext()) playNext() else stop()
    }

    fun seekToMs(ms: Long) = seekTo((ms / 1000).toInt())

    /** "3:45" / "1:02:33" → detik (fallback durasi sebelum metadata siap). */
    private fun parseDurSec(ts: String?): Int {
        if (ts.isNullOrBlank()) return 0
        val parts = ts.split(":").mapNotNull { it.trim().toIntOrNull() }
        return when (parts.size) {
            3 -> parts[0] * 3600 + parts[1] * 60 + parts[2]
            2 -> parts[0] * 60 + parts[1]
            else -> 0
        }
    }

    /** Stream audio (mp3) — playback hidup di scope global, bukan lifecycle UI. */
    fun streamAudio(client: GatewayClient, video: YtVideo, appContext: Context, onError: (String) -> Unit = {}) {
        stopInternal(clearQueue = false)
        nowPlaying = video
        nowArtist = video.author
        playFormat = "mp3"
        preparing = true
        positionSec = 0
        durationSec = parseDurSec(video.duration) // fallback, diperbarui metadata
        appCtx = appContext.applicationContext
        lastClient = client
        scope.launch {
            runCatching {
                val s = client.ytStream(video.videoId, "mp3")
                val p = withContext(Dispatchers.IO) {
                    android.media.MediaPlayer().apply {
                        setAudioAttributes(
                            android.media.AudioAttributes.Builder()
                                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                                .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                                .build()
                        )
                        setDataSource(s.streamUrl)
                        setOnPreparedListener { mp -> mp.start() }
                        // Hati-hati scope: tanpa qualifier ini manggil MediaPlayer.stop()
                        setOnCompletionListener { this@MusicPlayer.onTrackEnded() }
                        setOnErrorListener { _, _, _ ->
                            this@MusicPlayer.stop()
                            true
                        }
                        prepareAsync()
                    }
                }
                player = p
            }.onSuccess {
                preparing = false
                // Kunci utama anti-berhenti: foreground service + wake lock.
                // Service memegang notifikasi ongoing sehingga Android tidak
                // membunuh proses; wake lock menjaga CPU tetap jalan walau
                // layar mati.
                acquireWakeLock(appCtx!!)
                MusicService.createChannel(appCtx!!)
                MusicService.start(appCtx!!)
                startTicker()
                // Muat thumbnail lagu → album art utk notifikasi MediaStyle
                video.thumbnail?.let { thumbUrl ->
                    scope.launch {
                        val bmp = withContext(Dispatchers.IO) {
                            runCatching { client.fetchBitmap(thumbUrl) }.getOrNull()
                        }
                        if (bmp != null) {
                            currentArt = bmp
                            MusicService.refreshStatic(appCtx)
                        }
                    }
                }
            }.onFailure {
                preparing = false
                nowPlaying = null
                playFormat = null
                Toast.makeText(appContext, "Gagal stream: ${it.message}", Toast.LENGTH_SHORT).show()
                onError(it.message ?: "gagal")
            }
        }
    }

    /** Video: buka di player eksternal via URL stream gateway — tanpa file lokal. */
    fun streamVideo(client: GatewayClient, video: YtVideo, context: Context, onError: (String) -> Unit = {}) {
        stopInternal(clearQueue = false)
        nowPlaying = video
        nowArtist = video.author
        playFormat = "mp4"
        preparing = true
        appCtx = context.applicationContext
        scope.launch {
            runCatching {
                val s = client.ytStream(video.videoId, "mp4")
                val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                    setDataAndType(android.net.Uri.parse(s.streamUrl), "video/mp4")
                    addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            }.onSuccess {
                preparing = false
                // Video dibuka di player eksternal — app bisa ke background;
                // service + wake lock menjaga stream tidak diputus sistem.
                acquireWakeLock(appCtx!!)
                MusicService.createChannel(appCtx!!)
                MusicService.start(appCtx!!)
                startTicker()
            }.onFailure {
                preparing = false
                nowPlaying = null
                playFormat = null
                onError(it.message ?: "gagal")
            }
        }
    }
}

/**
 * Preferensi notifikasi chat (bisu/nyala) — persist di SharedPreferences.
 * Dipakai MainScreen (filter event) & SettingsTab (toggle).
 */
object NotifPrefs {
    private const val KEY = "notif_muted"

    fun isMuted(ctx: android.content.Context): Boolean =
        ctx.getSharedPreferences("mikuwa", android.content.Context.MODE_PRIVATE)
            .getBoolean(KEY, false)

    fun setMuted(ctx: android.content.Context, muted: Boolean) {
        ctx.getSharedPreferences("mikuwa", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean(KEY, muted).apply()
    }
}

/**
 * Preferensi Welcome Intro — SATU-SATUNYA source of truth (DESIGN.md #4-#6, #12-#14).
 * Persist di SharedPreferences "mikuwa" (storage yang sudah dipakai project).
 */
object WelcomePrefs {
    // Default URL hanya didefinisikan di sini (DESIGN.md #6)
    const val DEFAULT_URL = "https://example.com/welcome"
    private const val KEY_URL = "welcome_url"
    private const val KEY_ENABLED = "welcome_enabled"
    private const val KEY_COMPLETED = "welcome_completed"

    private fun prefs(ctx: android.content.Context) =
        ctx.getSharedPreferences("mikuwa", android.content.Context.MODE_PRIVATE)

    fun url(ctx: android.content.Context): String =
        prefs(ctx).getString(KEY_URL, DEFAULT_URL)?.takeIf { it.isNotBlank() } ?: DEFAULT_URL

    /** Simpan URL — dikembalikan null kalau valid, String pesan error kalau tidak. */
    fun setUrl(ctx: android.content.Context, raw: String): String? {
        val u = raw.trim()
        val scheme = u.substringBefore(":", "").lowercase()
        // DESIGN.md #7: hanya http/https; tolak javascript:/intent:/file:/content:
        if (scheme != "https" && scheme != "http") return "URL tidak valid"
        val parsed = runCatching { java.net.URI.create(u) }.getOrNull() ?: return "URL tidak valid"
        if (parsed.host.isNullOrBlank()) return "URL tidak valid"
        prefs(ctx).edit().putString(KEY_URL, u).apply()
        return null
    }

    fun enabled(ctx: android.content.Context): Boolean =
        prefs(ctx).getBoolean(KEY_ENABLED, false)

    fun setEnabled(ctx: android.content.Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(KEY_ENABLED, on).apply()
    }

    fun completed(ctx: android.content.Context): Boolean =
        prefs(ctx).getBoolean(KEY_COMPLETED, false)

    fun setCompleted(ctx: android.content.Context, done: Boolean) {
        prefs(ctx).edit().putBoolean(KEY_COMPLETED, done).apply()
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("mikuwa", MODE_PRIVATE)
        // Channel notifikasi dibuat saat app dibuka
        id.miku.waclient.data.NotificationHelper.createChannel(this)
        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    background = Bg, surface = Panel, primary = Accent,
                    onBackground = TextMain, onSurface = TextMain, outline = Border,
                ),
            ) {
                Surface(Modifier.fillMaxSize(), color = Bg) { AppRoot(prefs) }
            }
        }
    }
}

@Composable
fun AppRoot(prefs: android.content.SharedPreferences) {
    val context = LocalContext.current
    var baseUrl by remember { mutableStateOf(prefs.getString("gw_url", "") ?: "") }
    var token by remember { mutableStateOf(prefs.getString("token", null)) }
    var refreshToken by remember { mutableStateOf(prefs.getString("refresh", null)) }

    // ===== WELCOME INTRO FLOW (DESIGN.md #3, #12, #13) =====
    // Tampil hanya jika: setting ON dan belum pernah diselesaikan.
    // "Tampilkan Welcome Lagi" di Settings -> welcomeCompleted = false ->
    // intro tampil lagi di pembukaan berikutnya.
    var showWelcome by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        showWelcome = WelcomePrefs.enabled(context) && !WelcomePrefs.completed(context)
    }
    if (showWelcome) {
        WelcomeIntro(
            onFinish = {
                WelcomePrefs.setCompleted(context, true)
                showWelcome = false
            },
        )
        return
    }

    if (token == null) {
        LoginScreen(onLoggedIn = { url, t, r ->
            baseUrl = url; token = t; refreshToken = r
            prefs.edit().putString("gw_url", url).putString("token", t).putString("refresh", r).apply()
        })
    } else {
        val client = remember { GatewayClient(baseUrl) }
        LaunchedEffect(Unit) { client.setTokens(token, refreshToken) }
        MainScreen(
            client = client,
            baseUrl = baseUrl,
            onLogout = {
                prefs.edit().clear().apply()
                token = null
            },
            onTokensRotated = { t, r ->
                token = t; refreshToken = r
                prefs.edit().putString("token", t).putString("refresh", r).apply()
            },
        )
    }
}

// ===== LOGIN =====
@Composable
fun LoginScreen(onLoggedIn: (String, String, String) -> Unit) {
    var url by remember { mutableStateOf("https://mikujadibot.web.id") }
    var user by remember { mutableStateOf("admin") }
    var pass by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        Modifier.fillMaxSize().background(Bg).padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("MikuWA", fontSize = 26.sp, color = TextMain)
        Text("Custom client untuk bot WhatsApp", fontSize = 13.sp, color = TextMuted)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(url, { url = it }, Modifier.fillMaxWidth(), label = { Text("Gateway URL") }, singleLine = true)
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(user, { user = it }, Modifier.fillMaxWidth(), label = { Text("Username") }, singleLine = true)
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(pass, { pass = it }, Modifier.fillMaxWidth(), label = { Text("Password") }, visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(), singleLine = true)
        Spacer(Modifier.height(16.dp))
        if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        Button(
            onClick = {
                busy = true; err = ""
                scope.launch {
                    try {
                        val c = GatewayClient("")
                        val r = c.login(url, user.trim(), pass, "android")
                        onLoggedIn(url.trim(), r.getString("accessToken"), r.getString("refreshToken"))
                    } catch (e: Exception) {
                        err = e.message ?: "Login gagal"
                    }
                    busy = false
                }
            },
            enabled = !busy && pass.isNotBlank() && user.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (busy) "Menghubungkan..." else "Login") }
    }
}

// ===== WELCOME INTRO (DESIGN.md #3, #8-#11) =====
/**
 * Opening experience: typography MIKUWA + konten Welcome URL (WebView).
 * - Tombol [ MULAI ] selalu ada -> onFinish (welcomeCompleted = true).
 * - WebView TERISOLASI: tanpa JS bridge, tanpa file access, TANPA token/
 *   credential apa pun (DESIGN.md #8) — URL dari WelcomePrefs saja.
 * - Loading sederhana (#9), error retry/lewati (#10), offline fallback (#11).
 * - APK tidak pernah blank/crash: typography + MULAI selalu tampil.
 */
@Composable
fun WelcomeIntro(onFinish: () -> Unit) {
    val context = LocalContext.current
    val url = WelcomePrefs.url(context) // satu source of truth
    // webBody = WebView ditampilkan; failed = error state; offline = fallback
    var webBody by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }

    // Cek konektivitas utk offline fallback (DESIGN.md #11).
    // Dibungkus runCatching: walau permission ACCESS_NETWORK_STATE sudah ada,
    // beberapa device/ROM bisa melempar exception — Welcome tidak boleh crash.
    LaunchedEffect(Unit) {
        val hasNet = runCatching {
            val cm = context.getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
            caps?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        }.getOrDefault(true) // kalau tidak bisa cek -> anggap online, WebView yang putuskan
        if (!hasNet) {
            offline = true
            webBody = false
        }
    }

    Column(Modifier.fillMaxSize().background(Bg)) {
        // ===== TYPOGRAPHY HERO (selalu tampil — fokus utama, DESIGN.md #3) =====
        Column(Modifier.fillMaxWidth().padding(horizontal = 32.dp).padding(top = 64.dp, bottom = 20.dp)) {
            Text(
                "MIKUWA",
                color = Color(0xFFF2F3F5),
                fontSize = 44.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = (-1).sp,
                lineHeight = 44.sp,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "PRIVATE WHATSAPP CLIENT",
                color = Color(0xFFA6ABB5),
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 1.4.sp,
            )
            Spacer(Modifier.height(14.dp))
            Text(
                "Control your bot without\ntouching the terminal.",
                color = Color(0xFFA6ABB5),
                fontSize = 16.sp,
                lineHeight = 22.sp,
            )
        }

        // ===== BODY: WebView Welcome URL / error / offline =====
        Box(Modifier.fillMaxWidth().weight(1f)) {
            if (webBody) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        android.webkit.WebView(ctx).apply {
                            layoutParams = android.view.ViewGroup.LayoutParams(
                                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                            )
                            // ISOLASI (DESIGN.md #8): tanpa JS, tanpa file, tanpa bridge
                            settings.javaScriptEnabled = false
                            settings.allowFileAccess = false
                            settings.allowContentAccess = false
                            settings.domStorageEnabled = false
                            setBackgroundColor(android.graphics.Color.TRANSPARENT)
                            webViewClient = object : android.webkit.WebViewClient() {
                                @Deprecated("Deprecated in Java")
                                override fun onReceivedError(
                                    view: android.webkit.WebView,
                                    errorCode: Int,
                                    description: String?,
                                    failingUrl: String?,
                                ) {
                                    failed = true
                                    webBody = false
                                }
                            }
                            // Tanpa JWT/token/session/credential — URL polos dari prefs
                            loadUrl(url)
                        }
                    },
                    onRelease = { w -> runCatching { w.stopLoading(); w.destroy() } },
                )
                // Loading state (DESIGN.md #9): teks kecil di atas, bukan spinner besar
                Row(
                    Modifier.align(Alignment.TopCenter).padding(top = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("MIKUWA", color = TextMuted, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.width(8.dp))
                    Text("Loading...", color = TextMuted, fontSize = 13.sp)
                }
            } else if (failed) {
                // ERROR STATE (DESIGN.md #10)
                Column(
                    Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("Welcome page tidak dapat dimuat.", fontSize = 14.sp, color = TextMuted, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(14.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { failed = false; webBody = true }) { Text("Coba Lagi") }
                        OutlinedButton(onClick = onFinish) { Text("Lewati") }
                    }
                }
            } else {
                // OFFLINE FALLBACK (DESIGN.md #11)
                Column(
                    Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("Welcome page unavailable.", fontSize = 14.sp, color = TextMuted, textAlign = TextAlign.Center)
                }
            }
        }

        // ===== [ MULAI ] (selalu ada — APK tidak pernah blank) =====
        Box(Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 28.dp)) {
            Button(
                onClick = onFinish,
                modifier = Modifier.fillMaxWidth().height(48.dp), // DESIGN.md #17
                shape = RoundedCornerShape(24.dp),
            ) {
                Text(
                    if (offline) "Lanjutkan ke MikuWA" else "MULAI",
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

// ===== MAIN + BOTTOM NAV =====
@Composable
fun MainScreen(client: GatewayClient, baseUrl: String, onLogout: () -> Unit, onTokensRotated: (String, String) -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var openChatExternal by remember { mutableStateOf<Chat?>(null) }
    val context = LocalContext.current

    // WebSocket realtime
    val ws = remember { WsClient(baseUrl) }
    var botConnected by remember { mutableStateOf(false) }

    // ===== STATUS SESI BOT (WhatsApp) =====
    // "connected" = session WA aktif. Kalau bukan (disconnected/connecting/
    // reconnecting), fitur chat DISENGGOL — tapi Settings tetap bisa dibuka
    // (atur bot tanpa perlu session). Deteksi via REST + live update via WS.
    var botSession by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching { botSession = client.status().botState }
    }
    val hasSession = botSession == "connected"

    LaunchedEffect(Unit) {
        client.accessToken?.let { ws.connect(it) }
        ws.connected.collect { botConnected = it }
    }
    // WS tersambung (awal/reconnect) -> segarkan status sesi bot
    LaunchedEffect(botConnected) {
        if (botConnected) runCatching { botSession = client.status().botState }
    }
    DisposableEffect(Unit) { onDispose { ws.close() } }

    // Notifikasi pesan baru (Android 13+ butuh permission POST_NOTIFICATIONS;
    // diminta sekali di sini). Event WS message.received -> notifikasi.
    LaunchedEffect(Unit) {
        val activity = context as? android.app.Activity
        if (activity != null) id.miku.waclient.data.NotificationHelper.requestPermission(activity)
    }
    val notifEvent = ws.events.collectAsState().value
    LaunchedEffect(notifEvent) {
        val e = notifEvent ?: return@LaunchedEffect
        // Update status sesi bot realtime (ikutan event connection.updated)
        if (e.type == "connection.updated") {
            botSession = e.data?.optJSONObject("bot")?.optString("state") ?: botSession
            return@LaunchedEffect
        }
        if (e.type == "message.received" &&
            e.data?.optBoolean("isFromMe", false) != true &&
            !NotifPrefs.isMuted(context) // bisukan notifikasi chat dari Settings
        ) {
            val chatId = e.data?.optString("chatId") ?: return@LaunchedEffect
            // Jangan notif kalau chat yang sedang dibuka (biar tidak spam)
            if (chatId != openChatExternal?.id) {
                id.miku.waclient.data.NotificationHelper.showMessageNotification(
                    context,
                    chatId,
                    e.data?.optString("senderName")?.takeIf { it.isNotBlank() && it != "null" },
                    e.data?.optString("text")?.takeIf { it.isNotBlank() && it != "null" },
                )
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar(containerColor = Panel) {
                listOf("Chats", "Contacts", "Music", "Settings").forEachIndexed { i, label ->
                    val locked = (i == 0 || i == 1) && !hasSession
                    NavigationBarItem(
                        selected = tab == i,
                        onClick = {
                            // Chat terkunci tanpa session WA — Settings/Music bebas
                            if (!locked) tab = i else tab = 3
                        },
                        icon = {},
                        label = { Text(if (locked) "$label 🔒" else label) },
                    )
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad)) {
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f)) {
                    when (tab) {
                        0 -> ChatsTab(client, ws, snackbar, hasSession = hasSession, onOpenChat = { c -> openChatExternal = c }, onGoSettings = { tab = 3 })
                        1 -> ContactsTab(client, snackbar, hasSession = hasSession, onStartChat = { c -> openChatExternal = c }, onGoSettings = { tab = 3 })
                        2 -> MusicTab(client, snackbar)
                        else -> SettingsTab(client, onLogout, snackbar, botSession = botSession)
                    }
                }
                // Mini player global — musik tetap jalan & terkendali dari tab manapun
                if (tab != 2) MiniPlayerGlobal(onOpenMusic = { tab = 2 })
            }
        }
    }

    // Chat yang dibuka dari tab manapun (Chats/Contacts)
    openChatExternal?.let { chat ->
        ChatDetail(client, chat, ws, snackbar, onBack = { openChatExternal = null })
    }
}

/**
 * Placeholder tab terkunci: ditampilkan kalau session bot WA kosong.
 * Settings & Music tetap bisa dipakai tanpa session.
 */
@Composable
fun SessionRequiredPlaceholder(onGoSettings: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("🔒", fontSize = 42.sp)
        Spacer(Modifier.height(12.dp))
        Text("Session belum terhubung", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(
            "Fitur chat butuh sesi WhatsApp yang aktif.\nHubungkan bot dulu lewat server/gateway —\nSettings & Music tetap bisa dipakai.",
            fontSize = 13.sp, color = TextMuted, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(18.dp))
        Button(onClick = onGoSettings) { Text("Buka Settings") }
    }
}

// ===== CHATS TAB =====
// Buka page dulu (list kosong + loading), data dimuat di belakang, lalu
// auto-refresh tiap 3 detik biar chat ramai tetap ke-update tanpa rekayasa manual.
@Composable
fun ChatsTab(
    client: GatewayClient,
    ws: WsClient,
    snackbar: SnackbarHostState,
    hasSession: Boolean = true,
    onOpenChat: (Chat) -> Unit = {},
    onGoSettings: () -> Unit = {},
) {
    // Session bot WA kosong -> chat di-disable (Settings & Music tetap bisa)
    if (!hasSession) {
        SessionRequiredPlaceholder(onGoSettings = onGoSettings)
        return
    }
    var chats by remember { mutableStateOf<List<Chat>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var search by remember { mutableStateOf("") }
    var searchInput by remember { mutableStateOf("") }

    suspend fun load(s: String = search) {
        runCatching { chats = client.chats(s) }
            .onFailure { loading = false }
        loading = false
    }

    // Load awal + polling 3 detik (search pakai debounce manual)
    LaunchedEffect(hasSession) {
        if (!hasSession) return@LaunchedEffect
        load()
        while (true) {
            kotlinx.coroutines.delay(3000)
            if (searchInput == search) load()
        }
    }
    // Search baru diterapkan setelah user berhenti ngetik 600ms
    LaunchedEffect(searchInput) {
        kotlinx.coroutines.delay(600)
        if (hasSession && searchInput != search) {
            search = searchInput
            load(search)
        }
    }

    // Event realtime tetap dipakai untuk refresh instan
    val lastEvent = ws.events.collectAsState().value
    LaunchedEffect(lastEvent) {
        when (lastEvent?.type) {
            "message.received", "message.sent", "chat.read", "chat.updated" -> if (hasSession) load()
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("MikuWA", fontSize = 20.sp, modifier = Modifier.weight(1f))
            val on = ws.connected.collectAsState().value
            Text(if (on) "● WS" else "○ WS", fontSize = 12.sp, color = if (on) Color(0xFF3ECF8E) else TextMuted)
        }
        OutlinedTextField(
            searchInput, { searchInput = it },
            Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            placeholder = { Text("Cari chat...") }, singleLine = true,
        )
        Spacer(Modifier.height(4.dp))
        if (loading && chats.isEmpty()) {
            Box(Modifier.fillMaxWidth().padding(top = 40.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
            }
        }
        LazyColumn(Modifier.fillMaxSize()) {
            items(chats, key = { it.id }) { c ->
                ChatRow(c, client = client) { onOpenChat(c) }
                HorizontalDivider(color = Border, thickness = 0.5.dp)
            }
        }
    }
}

// ===== AVATAR: foto profil (fallback inisial) =====
@Composable
fun Avatar(client: GatewayClient?, jid: String?, label: String, size: Int = 44, corner: Int = 50) {
    var url by remember(jid) { mutableStateOf<String?>(null) }
    var failed by remember(jid) { mutableStateOf(false) }
    LaunchedEffect(jid) {
        if (jid == null || client == null) return@LaunchedEffect
        runCatching { url = client.avatar(jid) }
    }
    val shape = RoundedCornerShape(corner)
    if (url != null && !failed && client != null) {
        val painter = rememberAsyncPainter(url!!, client)
        if (painter != null) {
            Box(Modifier.size(size.dp).background(Panel2, shape)) {
                Image(
                    painter = painter, contentDescription = null,
                    modifier = Modifier.fillMaxSize().clip(shape), contentScale = ContentScale.Crop,
                )
            }
            return
        }
    }
    // Fallback: lingkaran inisial
    Box(Modifier.size(size.dp).background(Panel2, shape), contentAlignment = Alignment.Center) {
        Text(label.take(1).uppercase(), color = Accent, fontSize = (size * 0.42).sp)
    }
}

/** Painter bitmap sederhana: fetch di background, recompute saat bitmap siap. */
@Composable
fun rememberAsyncPainter(url: String, client: GatewayClient): Painter? {
    var bitmap by remember(url) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(url) {
        bitmap = withContext(Dispatchers.IO) { client.fetchBitmap(url) }
    }
    return bitmap?.let { BitmapPainter(it.asImageBitmap()) }
}

@Composable
fun ChatRow(c: Chat, client: GatewayClient? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Bg).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(client, c.id, if (c.isGroup) "#" else (c.name ?: "?"), 44)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(c.name ?: c.id, fontSize = 15.sp, modifier = Modifier.weight(1f), maxLines = 1)
                if (c.pinned) Text("📌", fontSize = 11.sp)
                if (c.muted) Text("🔇", fontSize = 11.sp)
                c.lastMessageTs?.let {
                    Text(fmtTime(it), fontSize = 11.sp, color = TextMuted)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(c.lastMessageText ?: "", fontSize = 13.sp, color = TextMuted, maxLines = 1, modifier = Modifier.weight(1f))
                if (c.unread > 0) {
                    Box(
                        Modifier.background(Accent, RoundedCornerShape(10.dp)).padding(horizontal = 7.dp, vertical = 1.dp),
                    ) { Text(c.unread.toString(), fontSize = 11.sp, color = Color.White) }
                }
            }
        }
    }
}

@Composable
fun ChatDetail(client: GatewayClient, chat: Chat, ws: WsClient, snackbar: SnackbarHostState? = null, onBack: () -> Unit) {
    val context = LocalContext.current
    var messages by remember { mutableStateOf<List<Message>>(emptyList()) }
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    var hasMore by remember { mutableStateOf(true) }
    var loadingOlder by remember { mutableStateOf(false) }

    // Menu context (long-press bubble): salin text / blokir pengirim
    var menuMsg by remember { mutableStateOf<Message?>(null) }
    var copiedText by remember { mutableStateOf<String?>(null) }
    // Panel member grup (dipakai menu ⋮ di header)
    var showMembers by remember { mutableStateOf(false) }

    // Revision chat: naik tiap event chat.updated (termasuk hasil migrasi
    // riwayat LID / history-sync di gateway) -> riwayat dimuat ulang otomatis.
    var chatRevision by remember(chat.id) { mutableIntStateOf(0) }

    // Muat halaman pertama (30 pesan terakhir) di belakang setelah page terbuka
    LaunchedEffect(chat.id, chatRevision) {
        runCatching { client.messagesPage(chat.id) }
            .onSuccess { page ->
                messages = page.messages
                hasMore = page.hasMore
                if (messages.isNotEmpty()) listState.scrollToItem(messages.size - 1)
            }
        runCatching { client.markRead(chat.id) }
        id.miku.waclient.data.NotificationHelper.cancel(context, chat.id)
    }

    // AUTO REFRESH 3 DETIK: tarik pesan baru dari gateway DB meski WS telat/
    // putus. Merge by messageId supaya tidak dobel, scroll hanya saat user
    // memang di dekat bawah (jangan ganggu yang sedang baca chat lama).
    LaunchedEffect(chat.id) {
        while (true) {
            kotlinx.coroutines.delay(3000)
            val fresh = runCatching { client.messagesPage(chat.id, limit = 30) }.getOrNull() ?: continue
            if (fresh.messages != messages) {
                val merged = (messages + fresh.messages).distinctBy { it.messageId }
                    .sortedBy { it.timestamp }
                val wasAtBottom = listState.firstVisibleItemIndex >= merged.size - 3
                messages = merged
                if (wasAtBottom && merged.isNotEmpty()) {
                    listState.animateScrollToItem(merged.size - 1)
                }
            }
        }
    }

    // AUTO LOAD PESAN LAMA: scroll mentok atas -> ambil halaman sebelumnya dari gateway
    LaunchedEffect(listState.firstVisibleItemIndex) {
        val idx = listState.firstVisibleItemIndex
        if (idx == 0 && messages.isNotEmpty() && hasMore && !loadingOlder) {
            loadingOlder = true
            val oldest = messages.first().timestamp
            runCatching { client.messagesPage(chat.id, before = oldest) }
                .onSuccess { page ->
                    if (page.messages.isNotEmpty()) {
                        val offset = listState.firstVisibleItemScrollOffset
                        messages = page.messages + messages // prepend, terlama di atas
                        hasMore = page.hasMore
                        // Jaga posisi scroll supaya tidak lompat saat item ditambah di atas
                        listState.scrollToItem(idx + page.messages.size, offset)
                    } else {
                        hasMore = false
                    }
                }
            loadingOlder = false
        }
    }
    // Realtime: pesan baru masuk
    val lastEvent = ws.events.collectAsState().value
    LaunchedEffect(lastEvent) {
        val e = lastEvent ?: return@LaunchedEffect
        // Chat berubah di gateway (migrasi riwayat, sync history, dll) ->
        // paksa muat ulang riwayat chat ini dari DB gateway.
        if (e.type == "chat.updated" && e.data?.optString("id") == chat.id) {
            chatRevision++
        }
        if (e.type in setOf("message.received", "message.sent")) {
            val d = e.data ?: return@LaunchedEffect
            if (d.optString("chatId") != chat.id) return@LaunchedEffect
            val id = d.optString("messageId")
            if (id.isNotEmpty() && messages.none { it.messageId == id }) {
                messages = messages + Message(
                    messageId = id, chatId = chat.id, text = d.optString("text", null),
                    senderName = d.optString("senderName", null),
                    senderId = d.optString("senderId", null),
                    isFromMe = e.type == "message.sent",
                    timestamp = d.optLong("timestamp", System.currentTimeMillis()),
                    status = d.optString("status", null), messageType = d.optString("messageType", "text"),
                )
                listState.animateScrollToItem(messages.size - 1)
            }
        }
    }

    Column(Modifier.fillMaxSize().background(Bg)) {
        // Header dengan avatar + tombol blokir (chat pribadi saja)
        Row(Modifier.fillMaxWidth().background(Panel).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("←") }
            Avatar(client, chat.id, chat.name ?: "?", 38)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(chat.name ?: chat.id, fontSize = 16.sp)
                Text(chat.id, fontSize = 11.sp, color = TextMuted)
            }
            if (!chat.isGroup) {
                TextButton(onClick = {
                    scope.launch {
                        runCatching { client.blockContact(chat.id) }
                            .onSuccess { snackbar?.showSnackbar("Nomor diblokir") }
                            .onFailure { snackbar?.showSnackbar("Gagal blokir: ${it.message}") }
                    }
                }) { Text("Blokir", color = Color(0xFFF0554D), fontSize = 13.sp) }
            }
            // Menu ⋮: kelola member (grup) / keluar grup / hapus chat
            var showChatMenu by remember { mutableStateOf(false) }
            var confirmAction by remember { mutableStateOf<String?>(null) } // "leave" | "delchat"
            Box {
                TextButton(onClick = { showChatMenu = true }) { Text("⋮", fontSize = 18.sp) }
                DropdownMenu(expanded = showChatMenu, onDismissRequest = { showChatMenu = false }) {
                    if (chat.isGroup) {
                        DropdownMenuItem(
                            text = { Text("👥 Member Grup") },
                            onClick = { showChatMenu = false; showMembers = true },
                        )
                        DropdownMenuItem(
                            text = { Text("🚪 Keluar Grup", color = Color(0xFFF0554D)) },
                            onClick = { showChatMenu = false; confirmAction = "leave" },
                        )
                    }
                    DropdownMenuItem(
                        text = { Text("🗑️ Hapus Chat", color = Color(0xFFF0554D)) },
                        onClick = { showChatMenu = false; confirmAction = "delchat" },
                    )
                }
            }
            // Dialog konfirmasi aksi destruktif
            confirmAction?.let { action ->
                val (title, desc) = when (action) {
                    "leave" -> "Keluar Grup" to "Bot akan MENINGGALKAN grup ini secara permanen. Lanjutkan?"
                    else -> "Hapus Chat" to "Seluruh pesan chat ini akan dihapus dari bot. Pesan di WhatsApp asli tidak ikut terhapus. Lanjutkan?"
                }
                AlertDialog(
                    onDismissRequest = { confirmAction = null },
                    title = { Text(title) },
                    text = { Text(desc, fontSize = 14.sp) },
                    confirmButton = {
                        TextButton(onClick = {
                            scope.launch {
                                runCatching {
                                    if (action == "leave") client.leaveGroup(chat.id) else client.deleteChat(chat.id)
                                }.onSuccess {
                                    snackbar?.showSnackbar(if (action == "leave") "Bot keluar dari grup" else "Chat dihapus")
                                    onBack()
                                }.onFailure { snackbar?.showSnackbar("Gagal: ${it.message}") }
                            }
                            confirmAction = null
                        }) { Text("Ya, Lanjut", color = Color(0xFFF0554D)) }
                    },
                    dismissButton = {
                        TextButton(onClick = { confirmAction = null }) { Text("Batal") }
                    },
                )
            }
        }
        // Messages
        LazyColumn(Modifier.weight(1f), state = listState, contentPadding = PaddingValues(12.dp)) {
            items(messages, key = { it.messageId }) { m ->
                Bubble(client, m, isGroup = chat.isGroup, onLongPress = { menuMsg = m })
                Spacer(Modifier.height(5.dp))
            }
        }
        // Composer + tombol lampiran (kirim media)
        var pendingSendMedia by remember { mutableStateOf(false) }
        Row(Modifier.fillMaxWidth().background(Panel).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            // Tombol 📎: pilih gambar/video dari galeri → kirim via gateway
            val pickMedia = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
                if (uri == null) return@rememberLauncherForActivityResult
                scope.launch {
                    pendingSendMedia = true
                    runCatching {
                        val ctx = context
                        val (bytes, name, mime) = readUriBytes(ctx, uri)
                        // Deteksi tipe PRIORITAS dari MIME resolver (akurat), lalu
                        // magic bytes (file picker sering kasih nama tanpa ekstensi).
                        val t = detectMediaType(name, mime, bytes)
                        val cap = input.trim().takeIf { it.isNotEmpty() }
                        val sent = client.sendMedia(
                            chat.id, bytes, t,
                            fileName = name.ifEmpty { "media_${System.currentTimeMillis()}" },
                            caption = cap,
                            mimeType = mime,
                        )
                        // Prime cache: bubble langsung render tanpa GET /media
                        client.primeMediaCache(chat.id, sent.messageId, bytes)
                        messages = messages + sent
                        input = "" // caption terpakai
                        listState.animateScrollToItem(messages.size - 1)
                    }.onFailure {
                        Toast.makeText(context, "Gagal kirim media: ${it.message}", Toast.LENGTH_SHORT).show()
                    }
                    pendingSendMedia = false
                }
            }
            TextButton(
                onClick = { pickMedia.launch("*/*") },
                enabled = !pendingSendMedia,
            ) {
                if (pendingSendMedia) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                } else {
                    Text("📎", fontSize = 18.sp)
                }
            }
            OutlinedTextField(
                input, { input = it },
                Modifier.weight(1f),
                placeholder = { Text("Ketik pesan...") },
                maxLines = 4,
            )
            Spacer(Modifier.width(8.dp))
            Button(onClick = {
                val text = input.trim()
                if (text.isEmpty()) return@Button
                input = ""
                scope.launch {
                    runCatching { client.sendMessage(chat.id, text) }
                        .onSuccess { sent ->
                            messages = messages + sent
                            listState.animateScrollToItem(messages.size - 1)
                        }
                        .onFailure { input = text } // restore input saat gagal
                }
            }) { Text("Kirim") }
        }
    }

    // Panel member grup (fullscreen overlay)
    if (showMembers && chat.isGroup) {
        GroupMembersPanel(
            client = client,
            chat = chat,
            snackbar = snackbar,
            onBack = { showMembers = false },
        )
    }

    // Dialog menu bubble: Salin text / Blokir pengirim
    menuMsg?.let { mm ->
        AlertDialog(
            onDismissRequest = { menuMsg = null; copiedText = null },
            title = { Text(mm.senderName ?: "Pesan") },
            text = {
                Column {
                    if (copiedText != null) {
                        Text("✓ Teks disalin ke clipboard", color = Color(0xFF3ECF8E), fontSize = 13.sp)
                    } else {
                        Text(mm.text ?: "[${mm.messageType}]", fontSize = 13.sp, color = TextMuted)
                    }
                }
            },
            confirmButton = {
                Row {
                    // Simpan gambar/sticker ke galeri — media di-fetch dulu bila belum termuat
                    if (mm.messageType == "image" || mm.messageType == "sticker") {
                        TextButton(onClick = {
                            scope.launch {
                                runCatching {
                                    val data = client.media(chat.id, mm.messageId)
                                        ?: throw Exception("Media tidak bisa diunduh")
                                    withContext(Dispatchers.IO) {
                                        saveToGallery(context, data, mm.messageId, isSticker = mm.messageType == "sticker")
                                    }
                                }.onSuccess { where ->
                                    Toast.makeText(context, "Tersimpan di $where ✓", Toast.LENGTH_SHORT).show()
                                    menuMsg = null; copiedText = null
                                }.onFailure {
                                    Toast.makeText(context, "Gagal simpan: ${it.message}", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }) { Text("💾 Galeri", color = Accent) }
                    }
                    TextButton(onClick = {
                        scope.launch {
                            // Text sudah ada di memory -> langsung salin; kalau tidak, ambil dari gateway
                            val text = mm.text ?: runCatching { client.messageText(chat.id, mm.messageId) }.getOrNull()
                            if (text != null) {
                                val cb = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                cb.setPrimaryClip(ClipData.newPlainText("message", text))
                                copiedText = text
                            } else {
                                menuMsg = null
                            }
                        }
                    }) { Text("Salin Text") }
                }
            },
            dismissButton = {
                Row {
                    // Hapus pesan — "Untuk Saya" selalu ada
                    TextButton(onClick = {
                        scope.launch {
                            runCatching { client.deleteMessage(chat.id, mm.messageId, "me") }
                                .onSuccess {
                                    messages = messages.filterNot { it.messageId == mm.messageId }
                                    snackbar?.showSnackbar("Pesan dihapus untuk saya")
                                }
                                .onFailure { snackbar?.showSnackbar("Gagal: ${it.message}") }
                            menuMsg = null; copiedText = null
                        }
                    }) { Text("🗑️ Saya", color = Accent) }
                    // Hapus untuk SEMUA — di grup bebas (asal bot admin), private hanya pesan bot
                    if (chat.isGroup || mm.isFromMe) {
                        TextButton(onClick = {
                            scope.launch {
                                runCatching { client.deleteMessage(chat.id, mm.messageId, "everyone") }
                                    .onSuccess {
                                        messages = messages.filterNot { it.messageId == mm.messageId }
                                        snackbar?.showSnackbar("Pesan dihapus untuk semua")
                                    }
                                    .onFailure { snackbar?.showSnackbar("Gagal: ${it.message}") }
                                menuMsg = null; copiedText = null
                            }
                        }) { Text("🗑️ Semua", color = Color(0xFFF0554D)) }
                    }
                    // Blokir nomor pengirim — hanya utk chat pribadi (bukan pesan grup)
                    if (!chat.isGroup && !mm.isFromMe) {
                        TextButton(onClick = {
                            scope.launch {
                                runCatching { client.blockContact(chat.id) }
                                    .onSuccess { snackbar?.showSnackbar("Nomor diblokir") }
                                    .onFailure { snackbar?.showSnackbar("Gagal blokir: ${it.message}") }
                                menuMsg = null; copiedText = null
                            }
                        }) { Text("Blokir", color = Color(0xFFF0554D)) }
                    }
                    TextButton(onClick = { menuMsg = null; copiedText = null }) { Text("Tutup") }
                }
            },
        )
    }
}

/** Format detik jadi m:ss (utk progress player). */
fun fmtDur(sec: Int): String {
    if (sec <= 0) return "0:00"
    val m = sec / 60
    val s = sec % 60
    return "$m:" + s.toString().padStart(2, '0')
}

/**
 * Mini player global: tampil di SEMUA tab kecuali Music (yang punya bar
 * lengkap sendiri) selama ada lagu diputar. Tap area → lompat ke tab Music.
 */
@Composable
fun MiniPlayerGlobal(onOpenMusic: () -> Unit) {
    val np = MusicPlayer.nowPlaying ?: return
    Column(
        Modifier.fillMaxWidth()
            .background(Panel2)
            .clickable { onOpenMusic() },
    ) {
        // Progress mini (tap = lompat ke tab Music, drag seek langsung)
        if (MusicPlayer.playFormat == "mp3" && !MusicPlayer.preparing && MusicPlayer.durationSec > 0) {
            Slider(
                value = MusicPlayer.positionSec.toFloat().coerceIn(0f, MusicPlayer.durationSec.toFloat()),
                onValueChange = { MusicPlayer.seekTo(it.toInt()) },
                valueRange = 0f..MusicPlayer.durationSec.toFloat(),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            )
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(if (MusicPlayer.playFormat == "mp3") "🎧" else "🎬", fontSize = 18.sp)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(np.title, fontSize = 13.sp, maxLines = 1)
                Text(
                    when {
                        MusicPlayer.preparing -> "menyiapkan stream..."
                        MusicPlayer.isPaused -> "dijeda"
                        MusicPlayer.playFormat == "mp3" -> {
                            val q = if (MusicPlayer.queueIndex >= 0 && MusicPlayer.queue.isNotEmpty())
                                " · ${MusicPlayer.queueIndex + 1}/${MusicPlayer.queue.size}"
                            else ""
                            "memutar — tetap jalan di background (${fmtDur(MusicPlayer.positionSec)}/${fmtDur(MusicPlayer.durationSec)})$q"
                        }
                        else -> "stream video dibuka"
                    },
                    fontSize = 11.sp, color = TextMuted,
                )
            }
            if (MusicPlayer.playFormat == "mp3" && !MusicPlayer.preparing) {
                TextButton(onClick = { MusicPlayer.playPrevious() }, enabled = MusicPlayer.hasPrev()) { Text("⏮") }
                TextButton(onClick = { MusicPlayer.pauseResume() }) { Text(if (MusicPlayer.isPaused) "▶" else "⏸") }
                TextButton(onClick = { MusicPlayer.playNext() }, enabled = MusicPlayer.hasNext()) { Text("⏭") }
            }
            TextButton(onClick = { MusicPlayer.stop() }) { Text("⏹", color = Color(0xFFF0554D)) }
        }
    }
}

/**
 * Tab Music: cari lagu via YouTube (endpoint bot) lalu STREAM langsung.
 * Audio = MediaPlayer stream; Video = terbuka di player eksternal atau
 * streaming via intent. TIDAK ada file yang diunduh ke storage HP.
 */
@Composable
fun MusicTab(client: GatewayClient, snackbar: SnackbarHostState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(false) }
    // Query diinisialisasi dari state global supaya tidak hilang saat pindah tab
    var query by remember { mutableStateOf(MusicPlayer.lastQuery) }
    // Player & hasil pencarian hidup di MusicPlayer (singleton) —
    // musik tetap jalan saat pindah tab / buka chat.

    fun doSearch(q: String = query) {
        if (q.isBlank()) return
        loading = true
        MusicPlayer.lastQuery = q
        scope.launch {
            runCatching { MusicPlayer.results = client.ytSearch(q) }
                .onFailure { snackbar.showSnackbar("Gagal cari: ${it.message}") }
            loading = false
            MusicPlayer.searched = true
        }
    }

    Column(Modifier.fillMaxSize().background(Bg)) {
        // Header
        Row(Modifier.fillMaxWidth().background(Panel).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("🎵 Music", fontSize = 18.sp, modifier = Modifier.weight(1f))
            Text("streaming only", fontSize = 11.sp, color = TextMuted)
        }
        // Search bar
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                query, { query = it },
                Modifier.weight(1f),
                placeholder = { Text("Cari lagu / video...") },
                singleLine = true,
                trailingIcon = {
                    if (query.isNotEmpty()) {
                        TextButton(onClick = {
                            query = ""; MusicPlayer.results = emptyList(); MusicPlayer.searched = false
                        }) { Text("✕") }
                    }
                },
            )
            Spacer(Modifier.width(6.dp))
            Button(onClick = { doSearch() }, enabled = !loading && query.isNotBlank()) {
                Text("🔍")
            }
        }
        // Now playing bar (state dari MusicPlayer global — sinkron semua tab)
        MusicPlayer.nowPlaying?.let { np ->
            Column(Modifier.fillMaxWidth().background(Panel2).padding(horizontal = 12.dp, vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(if (MusicPlayer.playFormat == "mp3") "🎧" else "🎬", fontSize = 18.sp)
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(np.title, fontSize = 13.sp, maxLines = 1)
                        Text(
                            when {
                                MusicPlayer.preparing -> "menyiapkan stream..."
                                MusicPlayer.isPaused -> "dijeda"
                                MusicPlayer.playFormat == "mp3" -> "memutar (audio) — aman di background"
                                else -> "stream video dibuka"
                            },
                            fontSize = 11.sp, color = TextMuted,
                        )
                    }
                    if (MusicPlayer.playFormat == "mp3" && !MusicPlayer.preparing) {
                        TextButton(onClick = { MusicPlayer.playPrevious() }, enabled = MusicPlayer.hasPrev()) { Text("⏮") }
                        TextButton(onClick = { MusicPlayer.pauseResume() }) { Text(if (MusicPlayer.isPaused) "▶" else "⏸") }
                        TextButton(onClick = { MusicPlayer.playNext() }, enabled = MusicPlayer.hasNext()) { Text("⏭") }
                    }
                    TextButton(onClick = { MusicPlayer.stop() }) { Text("⏹", color = Color(0xFFF0554D)) }
                }
                // Progress + seek (durasi valid begitu metadata siap)
                if (MusicPlayer.playFormat == "mp3" && !MusicPlayer.preparing && MusicPlayer.durationSec > 0) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(fmtDur(MusicPlayer.positionSec), fontSize = 10.sp, color = TextMuted)
                        Slider(
                            value = MusicPlayer.positionSec.toFloat().coerceIn(0f, MusicPlayer.durationSec.toFloat()),
                            onValueChange = { MusicPlayer.seekTo(it.toInt()) },
                            valueRange = 0f..MusicPlayer.durationSec.toFloat(),
                            modifier = Modifier.weight(1f).padding(horizontal = 6.dp),
                        )
                        Text(fmtDur(MusicPlayer.durationSec), fontSize = 10.sp, color = TextMuted)
                    }
                }
            }
        }
        // Indikator antrean (tampil saat ada lagu dalam antrean)
        if (MusicPlayer.queue.isNotEmpty() && MusicPlayer.queueIndex >= 0) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "🎶 Antrean ${MusicPlayer.queueIndex + 1}/${MusicPlayer.queue.size}",
                    fontSize = 11.sp, color = TextMuted, modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { MusicPlayer.autoNext = !MusicPlayer.autoNext }) {
                    Text(if (MusicPlayer.autoNext) "auto-next ON" else "auto-next OFF", fontSize = 11.sp)
                }
            }
        }
        // Hasil
        if (loading) {
            Box(Modifier.fillMaxWidth().padding(top = 40.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
            }
        } else if (MusicPlayer.results.isEmpty()) {
            Box(Modifier.fillMaxWidth().padding(top = 60.dp), contentAlignment = Alignment.Center) {
                Text(
                    if (MusicPlayer.searched) "Tidak ada hasil" else "Cari lagu favoritmu 🎶",
                    color = TextMuted, fontSize = 14.sp,
                )
            }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 4.dp)) {
                items(MusicPlayer.results, key = { it.videoId }) { v ->
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable(enabled = !MusicPlayer.preparing) {
                                MusicPlayer.playFromQueue(client, v, MusicPlayer.results, context.applicationContext)
                            }
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // Thumbnail
                        Box(Modifier.width(72.dp).height(44.dp).background(Panel2, RoundedCornerShape(6.dp))) {
                            v.thumbnail?.let { url ->
                                val painter = rememberAsyncPainter(url, client)
                                if (painter != null) {
                                    Image(
                                        painter = painter, contentDescription = null,
                                        modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(6.dp)),
                                        contentScale = ContentScale.Crop,
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(v.title, fontSize = 14.sp, maxLines = 2)
                            Spacer(Modifier.height(2.dp))
                            Text("${v.author} · ${v.duration}", fontSize = 11.sp, color = TextMuted)
                        }
                        // Tombol audio & video
                        TextButton(
                            onClick = { MusicPlayer.playFromQueue(client, v, MusicPlayer.results, context.applicationContext) },
                            enabled = !MusicPlayer.preparing,
                        ) { Text("🎧", fontSize = 16.sp) }
                        TextButton(
                            onClick = { MusicPlayer.streamVideo(client, v, context.applicationContext) },
                            enabled = !MusicPlayer.preparing,
                        ) { Text("▶️", fontSize = 16.sp) }
                    }
                    HorizontalDivider(color = Border, thickness = 0.5.dp)
                }
            }
        }
    }
}

/**
 * Panel kelola member grup: daftar member (dengan badge admin), tambah member
 * (input nomor, multi), kick member (long-press / tombol). Hanya untuk grup.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun GroupMembersPanel(
    client: GatewayClient,
    chat: Chat,
    snackbar: SnackbarHostState? = null,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var members by remember { mutableStateOf<List<GroupMember>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var addInput by remember { mutableStateOf("") }
    var inviteInput by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var kickTarget by remember { mutableStateOf<GroupMember?>(null) }
    // Target promote/demote admin: pasangan (member, action)
    var adminTarget by remember { mutableStateOf<Pair<GroupMember, String>?>(null) }

    LaunchedEffect(chat.id) {
        runCatching { members = client.groupMembers(chat.id) }
            .onFailure { snackbar?.showSnackbar("Gagal memuat member: ${it.message}") }
        loading = false
    }

    fun addMember() {
        val raw = addInput.trim()
        if (raw.isEmpty()) return
        val numbers = raw.split(",", " ", ";", "\n").map { it.trim() }.filter { it.isNotEmpty() }
        if (numbers.isEmpty()) return
        busy = true
        scope.launch {
            runCatching { client.addMembers(chat.id, numbers) }
                .onSuccess { (added, failed) ->
                    var hint403 = false
                    val msg = buildString {
                        append("Ditambah: ${added.size}")
                        if (failed.isNotEmpty()) {
                            append(" · Gagal: ${failed.size} (${failed.joinToString { it.second.take(30) }})")
                            // Deteksi 403 (nomor menolak ditambah — setting privasi WA)
                            // → auto-isi kolom undangan agar user tinggal tekan "Undang"
                            hint403 = failed.any { it.second.contains("403") }
                            if (hint403) inviteInput = failed.first().first.substringBefore("@")
                        }
                    }
                    snackbar?.showSnackbar(if (hint403) "$msg — nomor diisi ke form undangan ↓" else msg)
                    if (added.isNotEmpty()) {
                        addInput = ""
                        runCatching { members = client.groupMembers(chat.id) }
                    }
                }
                .onFailure { snackbar?.showSnackbar("Gagal: ${it.message}") }
            busy = false
        }
    }

    fun kickMember(mem: GroupMember) {
        busy = true
        scope.launch {
            runCatching { client.removeMembers(chat.id, listOf(mem.id)) }
                .onSuccess { (removed, failed) ->
                    if (removed.isNotEmpty()) {
                        snackbar?.showSnackbar("${mem.displayName} dikick")
                        members = members.filterNot { it.id == mem.id }
                    } else if (failed.isNotEmpty()) {
                        snackbar?.showSnackbar("Gagal kick: ${failed.firstOrNull()?.second}")
                    }
                }
                .onFailure { snackbar?.showSnackbar("Gagal: ${it.message}") }
            busy = false
        }
    }

    // Kirim link/kartu undangan grup ke nomor — solusi utk nomor yang
    // menolak ditambah langsung (error 403, setting privasi WA).
    fun sendInvite() {
        val raw = inviteInput.trim()
        if (raw.isEmpty()) return
        busy = true
        scope.launch {
            runCatching { client.sendGroupInvite(chat.id, raw) }
                .onSuccess {
                    snackbar?.showSnackbar("Undangan terkirim ke $raw ✓")
                    inviteInput = ""
                }
                .onFailure { snackbar?.showSnackbar("Gagal kirim undangan: ${it.message}") }
            busy = false
        }
    }

    // Promote/demote admin grup — bot harus admin; WA yang enforce sisanya
    // (superadmin/pembuat grup tidak bisa didemote).
    fun toggleAdmin(mem: GroupMember, action: String) {
        busy = true
        scope.launch {
            runCatching { client.setGroupAdmin(chat.id, listOf(mem.id), action) }
                .onSuccess { (changed, failed) ->
                    if (changed.isNotEmpty()) {
                        snackbar?.showSnackbar(
                            if (action == "promote") "${mem.displayName} sekarang admin ✓"
                            else "${mem.displayName} bukan admin lagi"
                        )
                        // Update list lokal tanpa refetch
                        members = members.map { if (it.id == mem.id) it.copy(isAdmin = action == "promote") else it }
                    } else if (failed.isNotEmpty()) {
                        snackbar?.showSnackbar("Gagal: ${failed.firstOrNull()?.second}")
                    }
                }
                .onFailure { snackbar?.showSnackbar("Gagal: ${it.message}") }
            busy = false
        }
    }

    Column(Modifier.fillMaxSize().background(Bg)) {
        // Header
        Row(Modifier.fillMaxWidth().background(Panel).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("←") }
            Column(Modifier.weight(1f)) {
                Text("Member Grup", fontSize = 16.sp)
                Text("${members.size} anggota", fontSize = 11.sp, color = TextMuted)
            }
        }
        // Form tambah member
        Row(Modifier.fillMaxWidth().background(Panel).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                addInput, { addInput = it },
                Modifier.weight(1f),
                placeholder = { Text("62xxx (pisah koma utk banyak)") },
                singleLine = true,
            )
            Spacer(Modifier.width(6.dp))
            Button(onClick = { addMember() }, enabled = !busy && addInput.isNotBlank()) {
                Text("Tambah")
            }
        }
        // Form kirim undangan (utk nomor yg menolak ditambah / 403)
        Row(Modifier.fillMaxWidth().background(Panel).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                inviteInput, { inviteInput = it },
                Modifier.weight(1f),
                placeholder = { Text("Kirim undangan: 62xxx (nomor 403)") },
                singleLine = true,
            )
            Spacer(Modifier.width(6.dp))
            Button(onClick = { sendInvite() }, enabled = !busy && inviteInput.isNotBlank()) {
                Text("Undang")
            }
        }
        // Daftar member
        if (loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
            }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 6.dp)) {
                items(members, key = { it.id }) { mem ->
                    Row(
                        Modifier.fillMaxWidth()
                            .combinedClickable(
                                onClick = {},
                                onLongClick = { if (!mem.isSuperAdmin) kickTarget = mem },
                            )
                            .padding(horizontal = 14.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(client, mem.id, mem.displayName, 40)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(mem.displayName, fontSize = 15.sp, maxLines = 1)
                                mem.adminLabel?.let {
                                    Spacer(Modifier.width(6.dp))
                                    Text(it, fontSize = 12.sp)
                                }
                            }
                            Text(mem.id.substringBefore("@"), fontSize = 11.sp, color = TextMuted)
                        }
                        // Aksi admin: promote/demote (superadmin tidak bisa diubah)
                        if (!mem.isSuperAdmin) {
                            TextButton(
                                onClick = { adminTarget = mem to (if (mem.isAdmin) "demote" else "promote") },
                                enabled = !busy,
                            ) {
                                Text(if (mem.isAdmin) "Demote" else "Promote", fontSize = 13.sp)
                            }
                        }
                        // Kick button (admin/superadmin tidak bisa dikick dari UI)
                        if (!mem.isAdmin) {
                            TextButton(onClick = { kickTarget = mem }, enabled = !busy) {
                                Text("Kick", color = Color(0xFFF0554D), fontSize = 13.sp)
                            }
                        }
                    }
                    HorizontalDivider(color = Border, thickness = 0.5.dp)
                }
            }
        }
    }

    // Konfirmasi kick
    kickTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { kickTarget = null },
            title = { Text("Kick ${target.displayName}?") },
            text = { Text("Member ini akan dikeluarkan dari grup oleh bot. Bot harus admin grup.", fontSize = 14.sp) },
            confirmButton = {
                TextButton(onClick = { kickTarget = null; kickMember(target) }) {
                    Text("Ya, Kick", color = Color(0xFFF0554D))
                }
            },
            dismissButton = {
                TextButton(onClick = { kickTarget = null }) { Text("Batal") }
            },
        )
    }

    // Konfirmasi promote/demote admin
    adminTarget?.let { (target, action) ->
        AlertDialog(
            onDismissRequest = { adminTarget = null },
            title = { Text(if (action == "promote") "Jadikan ${target.displayName} admin?" else "Copot admin ${target.displayName}?") },
            text = {
                Text(
                    if (action == "promote")
                        "Member ini akan bisa kick member, tambah member, dan edit info grup. Bot harus admin grup."
                    else
                        "Member ini akan kehilangan hak admin grup. Bot harus admin grup.",
                    fontSize = 14.sp,
                )
            },
            confirmButton = {
                TextButton(onClick = { adminTarget = null; toggleAdmin(target, action) }) {
                    Text(if (action == "promote") "Ya, Promote" else "Ya, Demote")
                }
            },
            dismissButton = {
                TextButton(onClick = { adminTarget = null }) { Text("Batal") }
            },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Bubble(client: GatewayClient? = null, m: Message, isGroup: Boolean = false, onLongPress: (() -> Unit)? = null) {
    // Identitas pengirim grup: nama + nomor (pesan lain, bukan pesan sendiri)
    val senderLabel = if (isGroup && !m.isFromMe) (m.senderName ?: m.senderId?.substringBefore("@")) else null
    val senderNumber = if (isGroup && !m.isFromMe) m.senderId?.substringBefore("@")?.takeIf { it.isNotBlank() } else null
    Row(
        Modifier.fillMaxWidth()
            .then(
                if (onLongPress != null) {
                    Modifier.combinedClickable(onClick = {}, onLongClick = { onLongPress() })
                } else Modifier
            ),
        horizontalArrangement = if (m.isFromMe) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom,
    ) {
        // Foto profil pengirim di kiri bubble (grup saja; pesan sendiri tanpa avatar)
        if (isGroup && !m.isFromMe) {
            Avatar(client, m.senderId, senderLabel ?: "?", 30)
            Spacer(Modifier.width(6.dp))
        }
        Column(
            Modifier.background(if (m.isFromMe) BubbleMe else Panel2, RoundedCornerShape(12.dp)).padding(9.dp).widthIn(max = 280.dp),
        ) {
            if (senderLabel != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(senderLabel, fontSize = 11.sp, color = Accent, fontWeight = FontWeight.SemiBold)
                    // Nomor pengirim di samping nama (kalau ada & beda dari nama)
                    if (senderNumber != null && senderNumber != senderLabel) {
                        Spacer(Modifier.width(5.dp))
                        Text(senderNumber, fontSize = 10.sp, color = TextMuted)
                    }
                }
                Spacer(Modifier.height(2.dp))
            }
            // Media (gambar/video/sticker) ditampilkan sebagai attachment;
            // caption/text tetap tampil di bawahnya bila ada.
            if (m.isMedia) {
                MediaAttachment(client, m)
            }
            val captionText = m.text?.takeIf { it.isNotBlank() }
            if (!m.isMedia || captionText != null) {
                Text(captionText ?: m.mediaLabel(), fontSize = 14.sp)
            }
            Text(
                fmtTime(m.timestamp) + if (m.isFromMe) " ✓" else "",
                fontSize = 9.sp, color = TextMuted, textAlign = TextAlign.End, modifier = Modifier.align(Alignment.End),
            )
        }
    }
}

/**
 * Attachment media dalam bubble: gambar & sticker dirender sebagai bitmap,
 * video pakai thumbnail frame pertama, audio/document/sticker-gagal tampil
 * sebagai chip label dengan tombol unduh (simpan ke galeri/Download).
 */
@Composable
fun MediaAttachment(client: GatewayClient?, m: Message) {
    if (client == null) {
        Text(m.mediaLabel(), fontSize = 13.sp, color = TextMuted)
        return
    }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bytes by remember(m.messageId) { mutableStateOf<ByteArray?>(null) }
    var failed by remember(m.messageId) { mutableStateOf(false) }
    var saving by remember(m.messageId) { mutableStateOf(false) }
    // Status tersimpan per message: null = belum, string = lokasi. Dipakai
    // supaya tombol download berubah jadi "✓ Tersimpan" setelah sukses.
    var savedWhere by remember(m.messageId) { mutableStateOf<String?>(null) }

    LaunchedEffect(m.messageId) {
        bytes = client.media(m.chatId, m.messageId)
        if (bytes == null) failed = true
    }

    // Simpan media sesuai tipe: image/sticker → galeri, video/audio/doc → Download.
    // Dipakai bersama oleh tap gambar maupun tombol download manual.
    fun saveMedia() {
        val data = bytes ?: return
        saving = true
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    if (m.messageType == "image" || m.messageType == "sticker") {
                        saveToGallery(context, data, m.messageId, isSticker = m.messageType == "sticker")
                    } else {
                        saveToDownloads(context, data, "mikuwa_${m.messageId}.${extFor(m.messageType)}", mimeFor(m.messageType))
                        "Download"
                    }
                }
            }.onSuccess { where ->
                Toast.makeText(context, "Tersimpan di $where ✓", Toast.LENGTH_SHORT).show()
                savedWhere = where
            }.onFailure {
                Toast.makeText(context, "Gagal simpan: ${it.message}", Toast.LENGTH_SHORT).show()
            }
            saving = false
        }
    }

    // ===== Tombol download manual — tampil di SEMUA bubble media =====
    @Composable
    fun DownloadButton() {
        TextButton(
            onClick = { if (!saving && bytes != null) saveMedia() },
            enabled = !saving && bytes != null && savedWhere == null,
        ) {
            when {
                saving -> {
                    CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(6.dp))
                    Text("Menyimpan...", fontSize = 12.sp)
                }
                savedWhere != null -> Text("✓ Tersimpan", fontSize = 12.sp, color = Color(0xFF3ECF8E))
                bytes == null -> Text("⬇ Unduh", fontSize = 12.sp, color = TextMuted)
                else -> Text("⬇ Simpan", fontSize = 12.sp, color = Accent)
            }
        }
    }

    when {
        // ===== IMAGE / STICKER: render bitmap langsung, tap = simpan ke galeri =====
        bytes != null && (m.messageType == "image" || m.messageType == "sticker") -> {
            val bmp = remember(m.messageId) {
                BitmapFactory.decodeByteArray(bytes, 0, bytes!!.size)
            }
            if (bmp != null) {
                Column {
                Box {
                    Image(
                        painter = BitmapPainter(bmp.asImageBitmap()),
                        contentDescription = m.mediaLabel(),
                        modifier = Modifier
                            .widthIn(max = 260.dp)
                            .heightIn(max = 320.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .clickable(enabled = !saving) { saveMedia() },
                        contentScale = ContentScale.FillWidth,
                    )
                    if (saving) {
                        CircularProgressIndicator(
                            Modifier.align(Alignment.Center).size(24.dp),
                            strokeWidth = 3.dp,
                            color = Color.White,
                        )
                    }
                }
                DownloadButton()
                }
            } else {
                // Bitmap gagal decode → hampir pasti STICKER ANIMASI (webp animasi).
                // Ini BUKAN "media tidak tersedia" — medianya utuh, cuma Android
                // tidak bisa render webp animasi via BitmapFactory. Tampilkan chip
                // dengan aksi simpan webp mentah.
                Text("✨ Stiker animasi", fontSize = 13.sp)
                DownloadButton()
            }
        }
        // ===== VIDEO: thumbnail frame + ikon play =====
        bytes != null && m.messageType == "video" -> {
            val thumb = remember(m.messageId) {
                runCatching {
                    val tmp = java.io.File.createTempFile("mikuwa", ".mp4", context.cacheDir)
                    tmp.writeBytes(bytes!!)
                    val b = ThumbnailUtils.createVideoThumbnail(tmp.absolutePath, MediaStore.Images.Thumbnails.MINI_KIND)
                    tmp.delete()
                    b
                }.getOrNull()
            }
            Column {
                Box(Modifier.widthIn(max = 260.dp)) {
                    if (thumb != null) {
                        Image(
                            painter = BitmapPainter(thumb.asImageBitmap()),
                            contentDescription = "Video",
                            modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp).clip(RoundedCornerShape(8.dp)),
                            contentScale = ContentScale.Crop,
                        )
                    }
                    Text(
                        "▶️ ${m.mediaLabel()}",
                        fontSize = 12.sp,
                        color = Color.White,
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .background(Color(0x99000000), RoundedCornerShape(6.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
                DownloadButton()
            }
        }
        // ===== AUDIO / DOCUMENT: chip label + tombol =====
        bytes != null -> {
            Column {
                Text(m.mediaLabel(), fontSize = 13.sp)
                DownloadButton()
            }
        }
        failed -> Column {
            MediaFallbackLabel(m)
            // Retry: media mungkin belum ada saat dimuat pertama (echo lambat),
            // tapi disk cache/store bot bisa sudah terisi setelahnya.
            TextButton(onClick = {
                failed = false
                scope.launch {
                    bytes = client.media(m.chatId, m.messageId)
                    if (bytes == null) failed = true
                    else Toast.makeText(context, "Media termuat ✓", Toast.LENGTH_SHORT).show()
                }
            }) { Text("🔄 Coba Lagi", fontSize = 12.sp, color = Accent) }
        }
        else -> Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(6.dp))
            Text("Memuat media...", fontSize = 12.sp, color = TextMuted)
        }
    }
}

@Composable
fun MediaFallbackLabel(m: Message) {
    Text(
        "${m.mediaLabel()} — media tidak tersedia",
        fontSize = 13.sp,
        color = TextMuted,
    )
}

private fun extFor(type: String): String = when (type) {
    "audio" -> "mp3"
    "document" -> "bin"
    "video" -> "mp4"
    "image" -> "jpg"
    "sticker" -> "webp"
    else -> "bin"
}

/**
 * Simpan gambar/sticker ke GALERI (Pictures/MikuWA) via MediaStore.Images.
 * - Foto: JPEG kualitas 95
 * - Sticker statis: re-encode PNG (pertahankan transparansi)
 * - Sticker animasi (webp animasi tak bisa didecode Bitmap): fallback
 *   simpan webp mentah ke folder Download.
 * Android 10+ pakai scoped storage (tanpa permission); Android 9- tulis file langsung.
 * @return lokasi penyimpanan utk ditampilkan di Toast.
 */
fun saveToGallery(context: android.content.Context, bytes: ByteArray, messageId: String, isSticker: Boolean): String {
    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    if (bmp == null) {
        // Sticker animasi / bitmap gagal decode → webp mentah ke Download
        saveToDownloads(context, bytes, "mikuwa_$messageId.webp", "image/webp")
        return "Download (stiker animasi)"
    }
    val mime = if (isSticker) "image/png" else "image/jpeg"
    val name = "mikuwa_$messageId." + if (isSticker) "png" else "jpg"
    val compress = if (isSticker) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
    val quality = if (isSticker) 100 else 95
    if (android.os.Build.VERSION.SDK_INT >= 29) {
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime)
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_PICTURES + "/MikuWA")
        }
        val uri = context.contentResolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            ?: throw Exception("Gagal membuat entri galeri")
        context.contentResolver.openOutputStream(uri)?.use { out ->
            if (!bmp.compress(compress, quality, out)) throw Exception("Gagal meng-encode gambar")
        } ?: throw Exception("Gagal menulis file")
    } else {
        @Suppress("DEPRECATION")
        val dir = java.io.File(
            android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES),
            "MikuWA",
        )
        if (!dir.exists()) dir.mkdirs()
        java.io.FileOutputStream(java.io.File(dir, name)).use { out ->
            if (!bmp.compress(compress, quality, out)) throw Exception("Gagal meng-encode gambar")
        }
    }
    return "Galeri · Pictures/MikuWA"
}

/**
 * Simpan bytes ke folder Download publik.
 * Android 10+ (API 29+): via MediaStore (scoped storage — tanpa permission).
 * Android 9-: langsung tulis file (permission WRITE_EXTERNAL_STORAGE).
 */
fun saveToDownloads(context: android.content.Context, bytes: ByteArray, name: String, mime: String) {
    if (android.os.Build.VERSION.SDK_INT >= 29) {
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime)
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS)
        }
        val uri = context.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw Exception("Gagal membuat entri MediaStore")
        context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            ?: throw Exception("Gagal membuka output stream")
    } else {
        @Suppress("DEPRECATION")
        val dir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
        val out = java.io.File(dir, name)
        out.writeBytes(bytes)
    }
}

private fun mimeFor(type: String): String = when (type) {
    "audio" -> "audio/mpeg"
    "video" -> "video/mp4"
    "image" -> "image/jpeg"
    "sticker" -> "image/webp"
    else -> "application/octet-stream"
}

/** Baca URI (hasil picker) jadi bytes + nama file + MIME aslinya. */
fun readUriBytes(context: android.content.Context, uri: Uri): Triple<ByteArray, String, String?> {
    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        ?: throw Exception("Tidak bisa membaca file")
    var name = ""
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
            val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0) c.getString(idx)?.let { name = it }
        }
    }
    val mime = context.contentResolver.getType(uri)
    return Triple(bytes, name, mime)
}

/**
 * Deteksi tipe media utk field `type` endpoint gateway.
 * Prioritas: MIME resolver → magic bytes → ekstensi nama → document.
 * Magic bytes penting: file picker sering kasih nama tanpa ekstensi (mis.
 * "IMG_1234" dari Google Photos) yang tadinya bikin foto terkirim sbg dokumen.
 */
fun detectMediaType(fileName: String, mime: String? = null, bytes: ByteArray? = null): String {
    // 1) MIME dari content resolver
    when {
        mime == null -> {}
        mime == "image/webp" -> return "sticker"
        mime.startsWith("image/") -> return "image"
        mime.startsWith("video/") -> return "video"
        mime.startsWith("audio/") -> return "audio"
    }
    // 2) Magic bytes (paling andal)
    if (bytes != null && bytes.size >= 12) {
        val h = bytes.sliceArray(0..11).joinToString("") { "%02x".format(it) }
        when {
            h.startsWith("ffd8") -> return "image"                      // JPEG
            h.startsWith("89504e470d0a1a0a") -> return "image"          // PNG
            h.startsWith("47494638") -> return "image"                  // GIF
            h.startsWith("52494646") && h.substring(16, 24) == "57454250" -> return "sticker" // WEBP (RIFF....WEBP)
            h.startsWith("1a45dfa3") -> return "video"                  // MKV/WebM
            h.startsWith("66747970") || h.substring(8, 16) == "66747970" -> return "video" // MP4/MOV (ftyp)
            h.startsWith("4f676753") -> return "audio"                  // OGG/Opus
            h.startsWith("494433") || h.startsWith("fffb") || h.startsWith("fff3") || h.startsWith("fff2") -> return "audio" // MP3
            h.startsWith("25504446") -> return "document"               // PDF
        }
    }
    // 3) Ekstensi nama file (fallback)
    val ext = fileName.substringAfterLast('.', "").lowercase()
    return when (ext) {
        "jpg", "jpeg", "png", "gif" -> "image"
        "webp" -> "sticker"
        "mp4", "mkv", "webm", "3gp", "mov" -> "video"
        "mp3", "ogg", "opus", "wav", "m4a", "aac" -> "audio"
        else -> "document"
    }
}

// ===== CONTACTS TAB (klik kontak -> mulai chat pribadi) =====
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ContactsTab(
    client: GatewayClient,
    snackbar: SnackbarHostState,
    hasSession: Boolean = true,
    onStartChat: (Chat) -> Unit = {},
    onGoSettings: () -> Unit = {},
) {
    // Session bot WA kosong -> kontak/chat di-disable
    if (!hasSession) {
        SessionRequiredPlaceholder(onGoSettings = onGoSettings)
        return
    }
    var contacts by remember { mutableStateOf<List<Contact>>(emptyList()) }
    var busyJid by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(hasSession) {
        if (!hasSession) return@LaunchedEffect
        runCatching { contacts = client.contacts() }
            .onFailure { snackbar.showSnackbar(it.message ?: "Gagal memuat") }
    }

    fun openChatWith(c: Contact) {
        if (busyJid != null) return
        busyJid = c.id
        scope.launch {
            val number = c.id.substringBefore("@")
            runCatching { client.startChat(number) }
                .onSuccess { chat ->
                    onStartChat(chat)
                    busyJid = null
                }
                .onFailure {
                    snackbar.showSnackbar(it.message ?: "Gagal mulai chat")
                    busyJid = null
                }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Text("Contacts", fontSize = 20.sp, modifier = Modifier.padding(14.dp))
        LazyColumn {
            items(contacts, key = { it.id }) { c ->
                Row(
                    Modifier.fillMaxWidth()
                        .then(if (busyJid == c.id) Modifier else Modifier.combinedClickable(onClick = { openChatWith(c) }))
                        .padding(horizontal = 14.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(client, c.id, c.name ?: c.notify ?: "?", 38)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(c.name ?: c.notify ?: c.id, fontSize = 15.sp)
                        Text(c.id, fontSize = 12.sp, color = TextMuted)
                    }
                    if (busyJid == c.id) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                }
                HorizontalDivider(color = Border, thickness = 0.5.dp)
            }
        }
    }
}

// ===== SETTINGS TAB (Profil Bot + Bot Settings + Plugins + Devices) =====
@Composable
fun SettingsTab(
    client: GatewayClient,
    onLogout: () -> Unit,
    snackbar: SnackbarHostState,
    botSession: String? = null,
) {
    val context = LocalContext.current
    var notifMuted by remember { mutableStateOf(NotifPrefs.isMuted(context)) }
    // Welcome Intro (DESIGN.md #4): URL + ON/OFF + reset — persist via WelcomePrefs
    var welcomeUrlInput by remember { mutableStateOf(WelcomePrefs.url(context)) }
    var welcomeErr by remember { mutableStateOf("") }
    var welcomeEnabled by remember { mutableStateOf(WelcomePrefs.enabled(context)) }
    var settings by remember { mutableStateOf<BotSettings?>(null) }
    var plugins by remember { mutableStateOf<List<Plugin>>(emptyList()) }
    var devices by remember { mutableStateOf<List<Device>>(emptyList()) }
    var profile by remember { mutableStateOf<BotProfile?>(null) }
    var profileName by remember { mutableStateOf("") }
    var profileBio by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        runCatching { settings = client.settings() }
        runCatching { plugins = client.plugins() }
        runCatching { devices = client.devices() }
        runCatching {
            profile = client.botProfile()
            profileName = profile?.name ?: ""
            profileBio = profile?.bio ?: ""
        }
    }

    // Foto profil bot (endpoint /api/bot/avatar) — aman walau session kosong
    var botAvatarUrl by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching { botAvatarUrl = client.botAvatar() }
    }

    fun patch(key: String, value: Any?) {
        scope.launch {
            runCatching { client.updateSettings(JSONObject().put(key, value)) }
                .onSuccess { snackbar.showSnackbar("$key diperbarui") }
                .onFailure { snackbar.showSnackbar("Gagal: ${it.message}") }
        }
    }

    Column(Modifier.fillMaxSize()) {
        // Banner typographic hero — video background + status session (DESIGN.md #1-#2)
        SettingsBanner(botSession)
        LazyColumn(Modifier.fillMaxSize().weight(1f), contentPadding = PaddingValues(14.dp)) {
        // ===== PROFIL BOT (PP + nomor + nama + bio — via WhatsApp) =====
        item {
            Text("Profil Bot", fontSize = 18.sp)
            Spacer(Modifier.height(8.dp))
            val p = profile
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Foto profil bot (bukan inisial kalau ada)
                if (botAvatarUrl != null) {
                    val painter = rememberAsyncPainter(botAvatarUrl!!, client)
                    Box(
                        Modifier.size(56.dp).background(Panel2, RoundedCornerShape(50)),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (painter != null) {
                            Image(
                                painter = painter, contentDescription = null,
                                modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(50)),
                                contentScale = ContentScale.Crop,
                            )
                        } else {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        }
                    }
                } else {
                    Avatar(null, null, p?.number?.take(2) ?: "?", 56)
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(p?.name ?: "...", fontSize = 16.sp)
                    Text("+${p?.number ?: "-"}", fontSize = 13.sp, color = TextMuted)
                }
            }
            Spacer(Modifier.height(10.dp))
            if (p != null) {
                OutlinedTextField(
                    profileName, { profileName = it },
                    Modifier.fillMaxWidth(), label = { Text("Nama Bot (WhatsApp)") }, singleLine = true,
                )
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(
                    profileBio, { profileBio = it },
                    Modifier.fillMaxWidth(), label = { Text("Bio / Status (maks 139)") },
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {
                        scope.launch {
                            val body = JSONObject()
                            if (profileName.isNotBlank() && profileName != (p.name ?: "")) body.put("name", profileName.trim())
                            if (profileBio.isNotBlank() && profileBio != (p.bio ?: "")) body.put("bio", profileBio.trim())
                            if (body.length() == 0) {
                                snackbar.showSnackbar("Tidak ada perubahan")
                                return@launch
                            }
                            runCatching { client.updateBotProfile(body) }
                                .onSuccess {
                                    snackbar.showSnackbar("Profil bot diperbarui")
                                    runCatching {
                                        profile = client.botProfile()
                                        profileName = profile?.name ?: ""
                                        profileBio = profile?.bio ?: ""
                                    }
                                }
                                .onFailure { snackbar.showSnackbar("Gagal: ${it.message}") }
                        }
                    }) { Text("Simpan Profil") }
                }
            } else {
                Text(
                    if (botSession == "connected") "Memuat profil..." else "Profil butuh session WA aktif",
                    fontSize = 13.sp, color = TextMuted,
                )
            }
            Spacer(Modifier.height(18.dp))
        }
        item {
            Text("Bot Settings", fontSize = 18.sp)
            Spacer(Modifier.height(8.dp))
            val s = settings
            if (s != null) {
                OutlinedTextField(
                    s.botName ?: "", {},
                    Modifier.fillMaxWidth(), label = { Text("Bot Name") }, enabled = false,
                )
                Spacer(Modifier.height(6.dp))
                Text("Mode", fontSize = 13.sp, color = TextMuted)
                Row {
                    listOf("public", "self").forEach { mode ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(
                                selected = s.mode == mode,
                                onClick = { patch("mode", mode) },
                            )
                            Text(mode.replaceFirstChar { it.uppercase() })
                        }
                    }
                }
                Text("Prefix", fontSize = 13.sp, color = TextMuted)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(".", "!", "#", "/", "").forEach { p ->
                        FilterChip(
                            selected = s.prefix == p,
                            onClick = { patch("prefix", p.ifEmpty { "." }) },
                            label = { Text(if (p.isEmpty()) "none" else p) },
                        )
                    }
                }
                SettingSwitch("Auto Read", s.autoRead == true) { patch("autoRead", it) }
                SettingSwitch("Auto Typing", s.autoTyping == true) { patch("autoTyping", it) }
                // Notifikasi chat masuk bisa dibisukan (tersimpan lokal di HP,
                // tidak mengubah setting bot di server)
                SettingSwitch("Notifikasi Chat Masuk", !notifMuted) { on ->
                    notifMuted = !on
                    NotifPrefs.setMuted(context, !on)
                }
            } else {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            }
            Spacer(Modifier.height(18.dp))
        }
        // ===== WELCOME INTRO (DESIGN.md #4) =====
        item {
            Spacer(Modifier.height(18.dp))
            Text("WELCOME INTRO", fontSize = 18.sp)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                welcomeUrlInput, { welcomeUrlInput = it; welcomeErr = "" },
                Modifier.fillMaxWidth(), label = { Text("Welcome URL") }, singleLine = true,
            )
            if (welcomeErr.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Text(welcomeErr, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    val e = WelcomePrefs.setUrl(context, welcomeUrlInput) // validasi http/https
                    if (e != null) welcomeErr = e
                    else scope.launch { snackbar.showSnackbar("Welcome URL disimpan") }
                }) { Text("Simpan") }
            }
            Spacer(Modifier.height(4.dp))
            SettingSwitch("Tampilkan Welcome Intro", welcomeEnabled) { on ->
                welcomeEnabled = on
                WelcomePrefs.setEnabled(context, on)
            }
            TextButton(onClick = {
                WelcomePrefs.setCompleted(context, false) // DESIGN.md #14: reset
                scope.launch { snackbar.showSnackbar("Welcome akan tampil lagi saat APK dibuka") }
            }) { Text("Tampilkan Welcome Lagi") }
            Spacer(Modifier.height(18.dp))
        }
        item { Text("Plugins", fontSize = 18.sp); Spacer(Modifier.height(6.dp)) }
        items(plugins, key = { it.name }) { p ->
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(p.name, fontSize = 15.sp)
                    Text(p.description ?: "", fontSize = 12.sp, color = TextMuted)
                }
                Switch(checked = p.enabled, onCheckedChange = { on ->
                    scope.launch {
                        runCatching { client.setPluginEnabled(p.name, on) }
                            .onSuccess { plugins = plugins.map { if (it.name == p.name) it.copy(enabled = on) else it } }
                            .onFailure { snackbar.showSnackbar("Gagal: ${it.message}") }
                    }
                })
            }
        }
        item {
            Spacer(Modifier.height(18.dp))
            Text("Devices", fontSize = 18.sp)
            Spacer(Modifier.height(6.dp))
        }
        items(devices, key = { it.id }) { d ->
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(d.name, fontSize = 15.sp)
                    Text(d.id.take(8) + " • " + fmtTime(d.lastSeenAt ?: 0), fontSize = 12.sp, color = TextMuted)
                }
                TextButton(onClick = {
                    scope.launch {
                        runCatching { client.revokeDevice(d.id) }
                            .onSuccess { devices = devices.filter { it.id != d.id } }
                    }
                }) { Text("Revoke", color = Color(0xFFF0554D)) }
            }
        }
        item {
            Spacer(Modifier.height(20.dp))
            Button(onClick = onLogout, Modifier.fillMaxWidth()) { Text("Logout") }
            Spacer(Modifier.height(30.dp))
        }
        }
    }
}

/**
 * Banner typographic hero di tab Settings (DESIGN.md #1-#2).
 * Video (autoplay, AUDIO SELALU ON, loop, tanpa controls) jadi BACKGROUND —
 * bukan video player biasa. Typography MIKUWA di atasnya + status session.
 * Pakai VideoView terpisah dari MusicPlayer (musik tab Music tidak ganggu).
 * Lifecycle: masuk Settings -> play (dari awal); pindah tab/app -> pause.
 */
@Composable
fun SettingsBanner(botSession: String? = null) {
    val bannerUrl = "https://u.pone.rs/bjvjtcia.mp4"

    // active = tab Settings terbuka & app foreground
    var active by remember { mutableStateOf(true) }
    var wasActive by remember { mutableStateOf<Boolean?>(null) }
    var videoView by remember { mutableStateOf<android.widget.VideoView?>(null) }
    // Counter re-layout: dipicu saat ukuran view berubah agar skala "cover"
    // dihitung ulang setelah layout benar-benar selesai (width > 0).
    var layoutTick by remember { mutableStateOf(0) }
    // Ukuran video (dari onVideoSizeChanged) — pemicu perhitungan skala cover
    var videoSize by remember { mutableStateOf(0 to 0) }
    // Ref MediaPlayer milik VideoView (setVolume dll hanya ada di MediaPlayer)
    var mpRef by remember { mutableStateOf<android.media.MediaPlayer?>(null) }

    // App background/foreground
    val lifecycleOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, event ->
            when (event) {
                androidx.lifecycle.Lifecycle.Event.ON_PAUSE -> active = false
                androidx.lifecycle.Lifecycle.Event.ON_RESUME -> active = true
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(obs)
        onDispose { lifecycleOwner.lifecycle.removeObserver(obs) }
    }

    // Kontrol playback HANYA saat transisi active. Audio WAJIB nyala tiap kali
    // banner aktif kembali: volume dipaksa penuh + audio focus diminta ulang.
    LaunchedEffect(active, videoView) {
        val v = videoView ?: return@LaunchedEffect
        when {
            // Kembali aktif setelah sempat dihentikan -> mulai ulang dari awal
            active && wasActive == false -> runCatching { v.setVideoURI(android.net.Uri.parse(bannerUrl)) }
            // Pertama kali / view reuse dari pool -> play/resume
            active -> runCatching { v.start() }
            // Non-aktif -> hentikan playback (audio ikut berhenti)
            else -> runCatching { v.pause() }
        }
        if (active) {
            runCatching { mpRef?.setVolume(1f, 1f) } // audio SELALU nyala saat banner aktif
            runCatching {
                val am = v.context.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager
                am.requestAudioFocus(null, android.media.AudioManager.STREAM_MUSIC, android.media.AudioManager.AUDIOFOCUS_GAIN)
            }
        }
        wasActive = active
    }

    // object-fit: cover — skala video menutupi penuh area banner lalu crop
    // tengah. Dijalankan ulang saat ukuran view berubah (layoutTick) atau
    // ukuran video diketahui, supaya FULL kiri-kanan sejak awal (bukan hitungan
    // salah saat view belum di-layout).
    LaunchedEffect(layoutTick, videoSize, videoView) {
        val v = videoView ?: return@LaunchedEffect
        val (w, h) = videoSize
        if (w <= 0 || h <= 0) return@LaunchedEffect
        val vw = v.width.coerceAtLeast(1).toFloat()
        val vh = v.height.coerceAtLeast(1).toFloat()
        val scale = maxOf(vw / w, vh / h)
        v.scaleX = scale
        v.scaleY = scale
        v.translationX = (vw - w * scale) / 2f
        v.translationY = (vh - h * scale) / 2f
    }

    Box(
        Modifier
            .fillMaxWidth() // FULL kiri-kanan (tanpa padding horizontal)
            .height(188.dp) // DESIGN.md #1: mobile 160-200px — tinggi stabil
            .clipToBounds() // video ber-scale cover tidak boleh merembes keluar banner
            .background(Bg),
    ) {
        // VIDEO BACKGROUND (object-fit cover penuh, center-crop)
        AndroidView(
            modifier = Modifier
                .matchParentSize()
                .onSizeChanged { layoutTick++ }, // re-scale saat ukuran berubah
            factory = { ctx ->
                val vv = android.widget.VideoView(ctx)
                vv.layoutParams = android.view.ViewGroup.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                )
                vv.setVideoURI(android.net.Uri.parse(bannerUrl))
                vv.setOnPreparedListener { mp ->
                    mp.isLooping = true // DESIGN.md #1: loop
                    mp.setVolume(1f, 1f) // AUDIO WAJIB: volume penuh sejak awal
                    mpRef = mp
                    runCatching {
                        val am = ctx.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager
                        am.requestAudioFocus(null, android.media.AudioManager.STREAM_MUSIC, android.media.AudioManager.AUDIOFOCUS_GAIN)
                    }
                    mp.setOnVideoSizeChangedListener { _, w, h -> videoSize = w to h }
                    if (mp.videoWidth > 0) videoSize = mp.videoWidth to mp.videoHeight
                    mp.start()
                }
                vv.setOnErrorListener { _, _, _ -> true } // gagal stream -> banner tetap tampil (bg polos)
                vv
            },
            // update: simpan ref view (juga saat view di-reuse dari pool Compose,
            // karena factory tidak dijalankan ulang). Set ref sama = tanpa rekomposisi.
            update = { v -> videoView = v },
            // onReset: view keluar dari composition (pindah tab) — Compose bisa
            // me-reuse view-nya, jadi pause di sini (bukan cuma onRelease).
            onReset = { v -> runCatching { v.pause() } },
            onRelease = { v ->
                runCatching { v.pause() } // playback stop saat view dibuang
                videoView = null
                mpRef = null
            },
        )
        // DARK OVERLAY subtle (DESIGN.md #1: rgba(0,0,0,0.35))
        Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = 0.35f)))
        // TYPOGRAPHY (DESIGN.md #1-#2): kiri, vertikal center, mobile padding
        Column(
            Modifier
                .matchParentSize()
                .padding(horizontal = 20.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                "MIKUWA",
                color = Color(0xFFF2F3F5),
                fontSize = 34.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = (-0.5).sp,
                lineHeight = 34.sp,
            )
            Text(
                "PRIVATE WHATSAPP CLIENT",
                color = Color(0xFFA6ABB5),
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 1.3.sp,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "Control your bot.\nWithout touching the terminal.",
                color = Color(0xFFA6ABB5),
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                lineHeight = 19.sp,
            )
            Spacer(Modifier.height(12.dp))
            val (dot, dotColor, label) = when (botSession) {
                "connected" -> Triple("●", Color(0xFF39D98A), "SESSION WHATSAPP AKTIF")
                null -> Triple("○", Color(0xFFA6ABB5), "MENGHUBUNGKAN WHATSAPP...")
                else -> Triple("×", Color(0xFFFF5F6D), "SESSION WHATSAPP TERPUTUS")
            }
            Text(
                "$dot $label",
                color = dotColor,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.8.sp,
            )
        }
    }
}

@Composable
fun SettingSwitch(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange, enabled = true)
    }
}

fun fmtTime(ts: Long): String =
    if (ts <= 0) "" else SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ts))
