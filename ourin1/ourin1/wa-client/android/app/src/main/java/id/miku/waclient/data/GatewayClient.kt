package id.miku.waclient.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Model sederhana */
data class Chat(
    val id: String,
    val name: String?,
    val lastMessageText: String?,
    val lastMessageTs: Long?,
    val unread: Int,
    val pinned: Boolean,
    val muted: Boolean,
    val isGroup: Boolean,
)

data class Message(
    val messageId: String,
    val chatId: String,
    val text: String?,
    val senderName: String?,
    val senderId: String? = null,
    val isFromMe: Boolean,
    val timestamp: Long,
    val status: String?,
    val messageType: String,
) {
    /** true bila pesan ini media yang bisa di-download via endpoint media */
    val isMedia: Boolean
        get() = messageType in setOf("image", "video", "audio", "sticker", "document")

    /** Label pendek untuk preview bubble sebelum media termuat */
    fun mediaLabel(): String = when (messageType) {
        "image" -> "🖼️ Foto"
        "video" -> "🎬 Video"
        "audio" -> "🎵 Audio"
        "sticker" -> "✨ Stiker"
        "document" -> "📄 Dokumen"
        else -> "[Media]"
    }
}

data class Contact(
    val id: String,
    val name: String?,
    val notify: String?,
)

data class BotSettings(
    val botName: String?,
    val mode: String?,
    val prefix: String?,
    val autoRead: Boolean?,
    val autoTyping: Boolean?,
)

data class Plugin(
    val name: String,
    val description: String?,
    val version: String?,
    val enabled: Boolean,
)

data class BotProfile(
    val number: String?,
    val name: String?,
    val bio: String?,
)

data class GroupMember(
    val id: String,
    val name: String?,
    val isAdmin: Boolean,
    val isSuperAdmin: Boolean,
) {
    val displayName: String get() = name ?: id.substringBefore("@")
    val adminLabel: String? get() = when {
        isSuperAdmin -> "👑"
        isAdmin -> "⚙️"
        else -> null
    }
}

data class YtVideo(
    val videoId: String,
    val title: String,
    val author: String,
    val duration: String,
    val views: Long,
    val thumbnail: String?,
    val url: String,
)

data class YtStream(
    val streamUrl: String,
    val title: String?,
    val format: String,
)

data class Device(
    val id: String,
    val name: String,
    val lastSeenAt: Long?,
    val revoked: Boolean,
)

data class GatewayStatus(
    val botState: String,
    val adapterMode: String,
    val botUptimeMs: Long,
)

/**
 * HTTP client untuk Gateway. APK hanya tahu GATEWAY_URL + token —
 * tidak ada secret lain di dalam APK.
 */
class GatewayClient(private var baseUrl: String) {

    private val json = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    // Client terpisah untuk media: timeout lebih panjang (file besar)
    private val mediaHttp = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    @Volatile
    var accessToken: String? = null
        private set

    @Volatile
    var refreshToken: String? = null
        private set

    fun setTokens(access: String?, refresh: String?) {
        accessToken = access
        refreshToken = refresh
    }

    private fun req(method: String, path: String, body: JSONObject? = null, auth: Boolean = true): Request {
        // Auto-append path mount kalau user cuma isi host domain
        val root = if (baseUrl.endsWith("/wa-gateway")) baseUrl else "$baseUrl/wa-gateway"
        val b = Request.Builder().url(root + path)
        when (method) {
            "POST" -> b.post((body?.toString() ?: "{}").toRequestBody(json))
            "PATCH" -> b.patch((body?.toString() ?: "{}").toRequestBody(json))
            "DELETE" -> b.delete()
            else -> b.get()
        }
        if (auth) accessToken?.let { b.header("Authorization", "Bearer $it") }
        return b.build()
    }

    private suspend fun call(request: Request): Pair<Int, JSONObject> = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use { resp ->
            val text = resp.body?.string() ?: "{}"
            Pair(resp.code, JSONObject(text))
        }
    }

    private suspend fun callMedia(request: Request): Pair<Int, okhttp3.Response> = withContext(Dispatchers.IO) {
        val resp = mediaHttp.newCall(request).execute()
        Pair(resp.code, resp)
    }

    /** Panggil API dengan auto-refresh token saat 401 */
    private suspend fun apiCall(method: String, path: String, body: JSONObject? = null): JSONObject {
        var (code, obj) = call(req(method, path, body))
        if (code == 401 && refreshToken != null) {
            if (refreshTokens()) {
                val retry = call(req(method, path, body))
                code = retry.first
                obj = retry.second
            }
        }
        if (code == 401) throw AuthExpiredException()
        if (!obj.optBoolean("ok", true) && obj.has("error")) throw ApiException(obj.getString("error"))
        if (code >= 400) throw ApiException(obj.optString("error", "HTTP $code"))
        return obj
    }

    // ===== Auth =====
    suspend fun login(url: String, username: String, password: String, deviceName: String): JSONObject {
        baseUrl = url.trimEnd('/')
        val body = JSONObject().put("username", username).put("password", password).put("deviceName", deviceName)
        val (code, obj) = call(req("POST", "/auth/login", body, auth = false))
        if (code != 200) throw ApiException(obj.optString("error", "Login gagal"))
        setTokens(obj.getString("accessToken"), obj.getString("refreshToken"))
        return obj
    }

    private suspend fun refreshTokens(): Boolean {
        val rt = refreshToken ?: return false
        val body = JSONObject().put("refreshToken", rt)
        val (code, obj) = call(req("POST", "/auth/refresh", body, auth = false))
        if (code != 200) return false
        setTokens(obj.getString("accessToken"), obj.optString("refreshToken", rt))
        return true
    }

    suspend fun logout() = runCatching { apiCall("POST", "/auth/logout") }

    suspend fun devices(): List<Device> {
        val arr = apiCall("GET", "/auth/devices").getJSONArray("devices")
        return (0 until arr.length()).map { i ->
            val d = arr.getJSONObject(i)
            Device(d.getString("id"), d.getString("name"), d.optLong("last_seen_at", 0), d.optInt("revoked", 0) == 1)
        }
    }

    suspend fun revokeDevice(id: String) = apiCall("DELETE", "/auth/devices/$id")

    // ===== Status =====
    suspend fun status(): GatewayStatus {
        val s = apiCall("GET", "/api/status")
        val bot = s.getJSONObject("bot")
        val gw = s.getJSONObject("gateway")
        return GatewayStatus(bot.getString("state"), gw.getString("adapterMode"), bot.getLong("uptimeMs"))
    }

    // ===== Chats =====
    suspend fun chats(search: String = ""): List<Chat> {
        val q = if (search.isNotBlank()) "?search=" + java.net.URLEncoder.encode(search, "UTF-8") else ""
        val arr = apiCall("GET", "/api/chats$q").getJSONArray("chats")
        return (0 until arr.length()).map { i ->
            val c = arr.getJSONObject(i)
            Chat(
                id = c.getString("id"),
                name = c.optString("name", null),
                lastMessageText = c.optString("last_message_text", null),
                lastMessageTs = if (c.isNull("last_message_ts")) null else c.getLong("last_message_ts"),
                unread = c.optInt("unread", 0),
                pinned = c.optInt("pinned", 0) == 1,
                muted = c.optInt("muted", 0) == 1,
                isGroup = c.optInt("is_group", 0) == 1,
            )
        }
    }

    suspend fun messages(chatId: String, limit: Int = 30, before: Long? = null): List<Message> {
        var q = "?limit=$limit"
        before?.let { q += "&before=$it" }
        val arr = apiCall("GET", "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/messages$q").getJSONArray("messages")
        return (0 until arr.length()).map { i ->
            val m = arr.getJSONObject(i)
            Message(
                messageId = m.getString("message_id"),
                chatId = m.getString("chat_id"),
                text = m.optString("text", null),
                senderName = m.optString("sender_name", null),
                senderId = m.optString("sender_id", null),
                isFromMe = m.optInt("is_from_me", 0) == 1,
                timestamp = m.getLong("timestamp"),
                status = m.optString("status", null),
                messageType = m.optString("message_type", "text"),
            )
        }
    }

    /**
     * Download media pesan (image/video/audio/sticker/document) dari gateway.
     * Hasilnya ByteArray — siap di-decode Bitmap / ditulis ke file cache.
     * Media di-cache di memori (LRU ~48MB) biar scroll chat tidak re-download.
     */
    private val mediaCache = object : android.util.LruCache<String, ByteArray>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ByteArray) = value.size
    }

    suspend fun media(chatId: String, messageId: String): ByteArray? {
        val cacheKey = "$chatId|$messageId"
        mediaCache.get(cacheKey)?.let { return it }
        return withContext(Dispatchers.IO) {
            runCatching {
                val enc = java.net.URLEncoder.encode(chatId, "UTF-8")
                val encId = java.net.URLEncoder.encode(messageId, "UTF-8")
                val req = Request.Builder()
                    .url(rootPath() + "/api/chats/$enc/messages/$encId/media")
                    .header("Authorization", "Bearer " + (accessToken ?: ""))
                    .build()
                val (code, resp) = callMedia(req)
                resp.use { r ->
                    if (code != 200) return@runCatching null
                    val bytes = r.body?.bytes() ?: return@runCatching null
                    if (bytes.isEmpty()) return@runCatching null
                    mediaCache.put(cacheKey, bytes)
                    bytes
                }
            }.getOrNull()
        }
    }

    /**
     * Prime cache setelah kirim media: bubble pesan keluar langsung render
     * tanpa harus GET /media dulu (yang dulu sering 404 sebelum echo masuk store).
     */
    fun primeMediaCache(chatId: String, messageId: String, bytes: ByteArray) {
        mediaCache.put("$chatId|$messageId", bytes)
    }

    private fun rootPath(): String {
        val base = baseUrl.trimEnd('/')
        return if (base.endsWith("/wa-gateway")) base else "$base/wa-gateway"
    }

    /**
     * Kirim media ke chat. Bisa multipart (file asli) atau base64 JSON.
     * type: image|video|audio|sticker|document
     */
    suspend fun sendMedia(
        chatId: String,
        bytes: ByteArray,
        type: String,
        fileName: String = "file",
        caption: String? = null,
        ptt: Boolean = false,
        replyTo: String? = null,
        mimeType: String? = null,
    ): Message {
        // Multipart via okhttp MultipartBody — lebih efisien daripada base64 JSON
        val enc = java.net.URLEncoder.encode(chatId, "UTF-8")
        val mime = (mimeType ?: guessMimeType(fileName) ?: "application/octet-stream").toMediaType()
        val bodyBuilder = okhttp3.MultipartBody.Builder()
            .setType(okhttp3.MultipartBody.FORM)
            .addFormDataPart("type", type)
            .addFormDataPart(
                "file", fileName,
                bytes.toRequestBody(mime),
            )
        caption?.takeIf { it.isNotBlank() }?.let { bodyBuilder.addFormDataPart("caption", it) }
        if (ptt) bodyBuilder.addFormDataPart("ptt", "true")
        replyTo?.let { bodyBuilder.addFormDataPart("replyTo", it) }

        val req = Request.Builder()
            .url(rootPath() + "/api/chats/$enc/media")
            .header("Authorization", "Bearer " + (accessToken ?: ""))
            .post(bodyBuilder.build())
            .build()

        val (code, resp) = callMedia(req)
        resp.use { _ ->
            val text = resp.body?.string() ?: "{}"
            val obj = JSONObject(text)
            if (code == 401) throw AuthExpiredException()
            if (code >= 400) throw ApiException(obj.optString("error", "HTTP $code"))
            val m = obj.getJSONObject("message")
            return Message(
                messageId = m.getString("messageId"),
                chatId = m.getString("chatId"),
                text = m.optString("text", null),
                senderName = m.optString("senderName", null),
                isFromMe = true,
                timestamp = m.getLong("timestamp"),
                status = m.optString("status", "sent"),
                messageType = m.optString("messageType", type),
            )
        }
    }

    private fun guessMimeType(fileName: String): String? {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        return when (ext) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "mp4" -> "video/mp4"
            "mkv" -> "video/x-matroska"
            "webm" -> "video/webm"
            "3gp" -> "video/3gpp"
            "mp3" -> "audio/mpeg"
            "ogg", "opus" -> "audio/ogg"
            "wav" -> "audio/wav"
            "m4a" -> "audio/mp4"
            "pdf" -> "application/pdf"
            "zip" -> "application/zip"
            "apk" -> "application/vnd.android.package-archive"
            else -> null
        }
    }

    /** Hasil load pesan: daftar + flag apakah masih ada halaman lebih lama. */
    data class MessagesPage(val messages: List<Message>, val hasMore: Boolean, val oldestTs: Long?)

    suspend fun messagesPage(chatId: String, limit: Int = 30, before: Long? = null): MessagesPage {
        var q = "?limit=$limit"
        before?.let { q += "&before=$it" }
        val obj = apiCall("GET", "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/messages$q")
        val arr = obj.getJSONArray("messages")
        val list = (0 until arr.length()).map { i ->
            val m = arr.getJSONObject(i)
            Message(
                messageId = m.getString("message_id"),
                chatId = m.getString("chat_id"),
                text = m.optString("text", null),
                senderName = m.optString("sender_name", null),
                senderId = m.optString("sender_id", null),
                isFromMe = m.optInt("is_from_me", 0) == 1,
                timestamp = m.getLong("timestamp"),
                status = m.optString("status", null),
                messageType = m.optString("message_type", "text"),
            )
        }
        return MessagesPage(
            messages = list,
            hasMore = obj.optBoolean("hasMore", false),
            oldestTs = list.firstOrNull()?.timestamp,
        )
    }

    suspend fun sendMessage(chatId: String, text: String, replyTo: String? = null): Message {
        val body = JSONObject().put("text", text)
        replyTo?.let { body.put("replyTo", it) }
        val m = apiCall("POST", "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/messages", body).getJSONObject("message")
        return Message(
            messageId = m.getString("messageId"),
            chatId = m.getString("chatId"),
            text = m.optString("text", null),
            senderName = m.optString("senderName", null),
            isFromMe = true,
            timestamp = m.getLong("timestamp"),
            status = m.optString("status", "sent"),
            messageType = m.optString("messageType", "text"),
        )
    }

    /** Download gambar avatar (dipanggil di Dispatchers.IO). */
    suspend fun fetchBitmap(url: String): android.graphics.Bitmap? = withContext(Dispatchers.IO) {
        runCatching {
            http.newCall(Request.Builder().url(url).build()).execute().use { resp ->
                if (!resp.isSuccessful) return@use null
                resp.body?.byteStream()?.use { android.graphics.BitmapFactory.decodeStream(it) }
            }
        }.getOrNull()
    }

    suspend fun markRead(chatId: String) =
        apiCall("PATCH", "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/read", JSONObject().put("unread", 0))

    // ===== Salin text: isi satu pesan =====
    suspend fun messageText(chatId: String, messageId: String): String? {
        val obj = apiCall(
            "GET",
            "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/messages/${java.net.URLEncoder.encode(messageId, "UTF-8")}/text",
        )
        return obj.optString("text", null)
    }

    // ===== Manajemen chat: keluar grup / hapus pesan / hapus chat =====

    /** Bot keluar dari grup ini. */
    suspend fun leaveGroup(chatId: String) {
        apiCall("POST", "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/leave", JSONObject())
    }

    /**
     * Hapus pesan.
     * @param scope "me" = hapus di sisi bot saja; "everyone" = unsend untuk semua
     *              (private: hanya pesan bot; grup: siapa pun asal bot admin)
     */
    suspend fun deleteMessage(chatId: String, messageId: String, scope: String = "me") {
        apiCall(
            "POST",
            "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/messages/${java.net.URLEncoder.encode(messageId, "UTF-8")}/delete",
            JSONObject().put("scope", scope),
        )
    }

    /** Hapus chat (nomor/grup) dari bot — hilang dari daftar chat gateway/APK. */
    suspend fun deleteChat(chatId: String) {
        apiCall("DELETE", "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}")
    }

    // ===== Kelola member grup (lihat / tambah / kick) =====

    suspend fun groupMembers(chatId: String): List<GroupMember> {
        val obj = apiCall("GET", "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/members")
        val arr = obj.getJSONArray("members")
        return (0 until arr.length()).map { i ->
            val mem = arr.getJSONObject(i)
            GroupMember(
                id = mem.getString("id"),
                name = mem.optString("name", null),
                isAdmin = mem.optBoolean("isAdmin", false),
                isSuperAdmin = mem.optBoolean("isSuperAdmin", false),
            )
        }
    }

    /** Tambah member. Return pasangan (sukses, gagal) utk ditampilkan di UI. */
    suspend fun addMembers(chatId: String, numbers: List<String>): Pair<List<String>, List<Pair<String, String>>> {
        val arr = JSONArray()
        numbers.forEach { arr.put(it.trim()) }
        val obj = apiCall(
            "POST",
            "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/members/add",
            JSONObject().put("jids", arr),
        )
        val added = mutableListOf<String>()
        obj.optJSONArray("added")?.let { a -> (0 until a.length()).forEach { added.add(a.getString(it)) } }
        val failed = mutableListOf<Pair<String, String>>()
        obj.optJSONArray("failed")?.let { a ->
            (0 until a.length()).forEach {
                val f = a.getJSONObject(it)
                failed.add(f.getString("jid") to f.optString("error", "gagal"))
            }
        }
        return added to failed
    }

    /** Kick member. Return pasangan (sukses, gagal) utk ditampilkan di UI. */
    suspend fun removeMembers(chatId: String, numbers: List<String>): Pair<List<String>, List<Pair<String, String>>> {
        val arr = JSONArray()
        numbers.forEach { arr.put(it.trim()) }
        val obj = apiCall(
            "POST",
            "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/members/remove",
            JSONObject().put("jids", arr),
        )
        val removed = mutableListOf<String>()
        obj.optJSONArray("removed")?.let { a -> (0 until a.length()).forEach { removed.add(a.getString(it)) } }
        val failed = mutableListOf<Pair<String, String>>()
        obj.optJSONArray("failed")?.let { a ->
            (0 until a.length()).forEach {
                val f = a.getJSONObject(it)
                failed.add(f.getString("jid") to f.optString("error", "gagal"))
            }
        }
        return removed to failed
    }

    /** Promote/demote admin grup. Return pasangan (sukses, gagal). */
    suspend fun setGroupAdmin(chatId: String, numbers: List<String>, action: String): Pair<List<String>, List<Pair<String, String>>> {
        val arr = JSONArray()
        numbers.forEach { arr.put(it.trim()) }
        val obj = apiCall(
            "POST",
            "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/members/admin",
            JSONObject().put("jids", arr).put("action", action),
        )
        val changed = mutableListOf<String>()
        obj.optJSONArray("changed")?.let { a -> (0 until a.length()).forEach { changed.add(a.getString(it)) } }
        val failed = mutableListOf<Pair<String, String>>()
        obj.optJSONArray("failed")?.let { a ->
            (0 until a.length()).forEach {
                val f = a.getJSONObject(it)
                failed.add(f.getString("jid") to f.optString("error", "gagal"))
            }
        }
        return changed to failed
    }

    /** Kirim link undangan grup ke nomor (utk nomor yang menolak ditambah / 403). */
    suspend fun sendGroupInvite(chatId: String, number: String, message: String? = null) {
        val body = JSONObject().put("number", number)
        message?.let { body.put("message", it) }
        apiCall("POST", "/api/chats/${java.net.URLEncoder.encode(chatId, "UTF-8")}/members/invite", body)
    }

    // ===== YouTube Music (STREAMING — bukan download ke HP) =====

    suspend fun ytSearch(query: String): List<YtVideo> {
        val q = java.net.URLEncoder.encode(query.trim(), "UTF-8")
        val arr = apiCall("GET", "/api/media/youtube/search?q=$q").getJSONArray("videos")
        return (0 until arr.length()).map { i ->
            val v = arr.getJSONObject(i)
            YtVideo(
                videoId = v.getString("videoId"),
                title = v.optString("title", ""),
                author = v.optString("author", ""),
                duration = v.optString("duration", ""),
                views = v.optLong("views", 0),
                thumbnail = v.optString("thumbnail", null),
                url = v.optString("url", ""),
            )
        }
    }

    /**
     * Minta URL stream mp3/mp4. TIDAK mengunduh file ke storage —
     * URL dipakai MediaPlayer/ExoPlayer untuk streaming langsung.
     */
    suspend fun ytStream(videoId: String, format: String): YtStream {
        val id = java.net.URLEncoder.encode(videoId, "UTF-8")
        val obj = apiCall("GET", "/api/media/youtube/stream?videoId=$id&format=$format")
        return YtStream(
            streamUrl = obj.getString("streamUrl"),
            title = obj.optString("title", null),
            format = obj.optString("format", format),
        )
    }

    // ===== Blokir nomor (chat pribadi) =====
    suspend fun blockedNumbers(): List<String> {
        val arr = apiCall("GET", "/api/blocked").getJSONArray("blocked")
        return (0 until arr.length()).map { i -> arr.getString(i) }
    }

    suspend fun blockContact(jid: String) =
        apiCall("POST", "/api/blocked", JSONObject().put("jid", jid))

    suspend fun unblockContact(jid: String) =
        apiCall("DELETE", "/api/blocked/${java.net.URLEncoder.encode(jid, "UTF-8")}")

    // ===== Profil bot (nomor, nama, bio) =====
    suspend fun botProfile(): BotProfile {
        val p = apiCall("GET", "/api/bot/profile").getJSONObject("profile")
        return BotProfile(
            number = p.optString("number", null),
            name = p.optString("name", null),
            bio = p.optString("bio", null),
        )
    }

    /** Foto profil bot sendiri (null kalau tidak ada / disembunyikan). */
    suspend fun botAvatar(): String? = withContext(Dispatchers.IO) {
        runCatching {
            apiCall("GET", "/api/bot/avatar").optString("url", null)
                ?.takeIf { it.isNotBlank() && it != "null" }
        }.getOrNull()
    }

    suspend fun updateBotProfile(patch: JSONObject) = apiCall("PATCH", "/api/bot/profile", patch)

    // ===== Mulai chat pribadi dari kontak =====
    suspend fun startChat(number: String): Chat {
        val c = apiCall("POST", "/api/chats", JSONObject().put("number", number)).getJSONObject("chat")
        return Chat(
            id = c.getString("id"),
            name = c.optString("name", null),
            lastMessageText = c.optString("lastMessageText", null),
            lastMessageTs = if (c.isNull("lastMessageTs")) null else c.getLong("lastMessageTs"),
            unread = c.optInt("unread", 0),
            pinned = false,
            muted = false,
            isGroup = false,
        )
    }

    // ===== Avatar (foto profil) — cache memori 6 jam per JID =====
    private val avatarCache = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, String?>>()

    suspend fun avatar(jid: String): String? = withContext(Dispatchers.IO) {
        val cached = avatarCache[jid]
        if (cached != null && System.currentTimeMillis() - cached.first < 6 * 60 * 60 * 1000L) {
            return@withContext cached.second
        }
        val enc = java.net.URLEncoder.encode(jid, "UTF-8")
        val url = runCatching { apiCall("GET", "/api/avatars/$enc").optString("url", null) }
            .getOrNull()
            ?.takeIf { it.isNotBlank() && it != "null" }
        avatarCache[jid] = Pair(System.currentTimeMillis(), url)
        url
    }

    // ===== Contacts / Groups =====
    suspend fun contacts(): List<Contact> {
        val arr = apiCall("GET", "/api/contacts").getJSONArray("contacts")
        return (0 until arr.length()).map { i ->
            val c = arr.getJSONObject(i)
            Contact(c.getString("id"), c.optString("name", null), c.optString("notify", null))
        }
    }

    // ===== Settings =====
    suspend fun settings(): BotSettings {
        val s = apiCall("GET", "/api/bot/settings").getJSONObject("settings")
        return BotSettings(
            botName = s.optString("botName", null),
            mode = s.optString("mode", null),
            prefix = s.optString("prefix", null),
            autoRead = if (s.has("autoRead")) s.getBoolean("autoRead") else null,
            autoTyping = if (s.has("autoTyping")) s.getBoolean("autoTyping") else null,
        )
    }

    suspend fun updateSettings(patch: JSONObject) = apiCall("PATCH", "/api/bot/settings", patch)

    // ===== Plugins =====
    suspend fun plugins(): List<Plugin> {
        val arr = apiCall("GET", "/api/plugins").getJSONArray("plugins")
        return (0 until arr.length()).map { i ->
            val p = arr.getJSONObject(i)
            Plugin(p.getString("name"), p.optString("description", null), p.optString("version", null), p.getBoolean("enabled"))
        }
    }

    suspend fun setPluginEnabled(name: String, enabled: Boolean) =
        apiCall("PATCH", "/api/plugins/${java.net.URLEncoder.encode(name, "UTF-8")}", JSONObject().put("enabled", enabled))

    companion object {
        fun wsUrl(baseUrl: String, token: String): String {
            val base = baseUrl.trimEnd('/')
            // Kalau user isi base URL tanpa path (mis. https://mikujadibot.web.id),
            // otomatis tambahkan path mount gateway /wa-gateway.
            val withPath = if (base.endsWith("/wa-gateway")) base else "$base/wa-gateway"
            return withPath.replaceFirst("http", "ws") + "/ws?token=" + java.net.URLEncoder.encode(token, "UTF-8")
        }
    }
}

class AuthExpiredException : Exception("Sesi berakhir, silakan login lagi")
class ApiException(msg: String) : Exception(msg)
