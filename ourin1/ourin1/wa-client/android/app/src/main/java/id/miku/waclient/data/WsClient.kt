package id.miku.waclient.data

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Event realtime dari Gateway via WebSocket.
 * Reconnect exponential backoff + heartbeat ping.
 */
class WsClient(private val baseUrl: String) {

    data class WsEvent(val type: String, val data: JSONObject?)

    private val _events = MutableStateFlow<WsEvent?>(null)
    val events: StateFlow<WsEvent?> = _events

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected

    private val http = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    private var ws: WebSocket? = null
    private var retry = 0
    private var token: String? = null
    private var closedByUser = false

    fun connect(accessToken: String) {
        token = accessToken
        closedByUser = false
        open()
    }

    private fun open() {
        val t = token ?: return
        val request = Request.Builder().url(GatewayClient.wsUrl(baseUrl, t)).build()
        ws = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                retry = 0
                _connected.value = true
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val obj = JSONObject(text)
                    _events.value = WsEvent(obj.optString("type"), obj.optJSONObject("data"))
                } catch (_: Exception) { /* abaikan frame tidak valid */ }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                _connected.value = false
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _connected.value = false
                if (code == 4001) {
                    // token invalid/expired — jangan reconnect loop; biarkan UI paksa relogin
                    closedByUser = true
                }
                if (!closedByUser) scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (closedByUser) return
        val delaySec = (2.0 * Math.pow(1.7, retry.toDouble())).coerceAtMost(30.0).toLong()
        retry++
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ open() }, delaySec * 1000)
    }

    fun close() {
        closedByUser = true
        ws?.close(1000, "bye")
        _connected.value = false
    }
}
