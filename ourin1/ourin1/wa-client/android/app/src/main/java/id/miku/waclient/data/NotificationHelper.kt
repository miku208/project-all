package id.miku.waclient.data

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import id.miku.waclient.MainActivity
import id.miku.waclient.R

/**
 * Notifikasi pesan baru untuk MikuWA.
 * - Channel "messages" (importance HIGH -> heads-up + icon status bar)
 * - Android 13+ wajib runtime permission POST_NOTIFICATIONS
 * - Notifikasi di-build dari event WS "message.received" saat app hidup
 *   (foreground atau background selama proses masih ada).
 */
object NotificationHelper {

    const val CHANNEL_ID = "messages"
    private const val CHANNEL_NAME = "Pesan Baru"
    private const val CHANNEL_DESC = "Notifikasi pesan WhatsApp baru yang masuk lewat bot"

    fun hasPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true // di bawah 13 otomatis granted
        return context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    /** Minta permission notifikasi (Android 13+). Return true kalau sudah granted. */
    fun requestPermission(activity: android.app.Activity): Boolean {
        if (hasPermission(activity)) return true
        if (Build.VERSION.SDK_INT >= 33) {
            activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
        return false
    }

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val channel = NotificationChannel(
            CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = CHANNEL_DESC
        }
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }

    /** Tampilkan notifikasi pesan baru. returnToChat = JID chat yang dibuka saat tap. */
    fun showMessageNotification(context: Context, chatId: String, chatName: String?, text: String?) {
        if (!hasPermission(context)) return
        createChannel(context)

        val body = text ?: "[${if (text == null) "media" else ""}]"
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notif)
            .setContentTitle(chatName ?: chatId.substringBefore("@"))
            .setContentText(body.take(120))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    context,
                    chatId.hashCode(),
                    Intent(context, MainActivity::class.java).apply {
                        putExtra("openChat", chatId)
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    },
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()

        try {
            NotificationManagerCompat.from(context).notify(chatId.hashCode(), notif)
        } catch (_: SecurityException) {
        }
    }

    fun cancel(context: Context, chatId: String) {
        NotificationManagerCompat.from(context).cancel(chatId.hashCode())
    }
}
