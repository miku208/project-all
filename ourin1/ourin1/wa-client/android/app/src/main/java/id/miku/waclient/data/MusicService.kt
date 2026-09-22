package id.miku.waclient.data

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.view.KeyEvent
import androidx.media.app.NotificationCompat.MediaStyle
import id.miku.waclient.MainActivity
import id.miku.waclient.MusicPlayer
import id.miku.waclient.R

/**
 * Foreground service untuk playback musik.
 *
 * Notifikasi memakai MediaStyle (gaya Spotify): judul lagu, artis, durasi,
 * thumbnail album, progress bar, dan tombol prev/play-pause/next. Karena ada
 * foreground service + wake lock, Android tidak mematikan proses app saat
 * user pindah tab/app lain atau layar mati → musik tetap jalan.
 *
 * MediaSession membuat tombol di headset & media card layar kunci ikut bekerja.
 */
class MusicService : Service() {

    companion object {
        const val CHANNEL_ID = "music_playback"
        const val NOTIF_ID = 4242

        const val ACTION_TOGGLE = "id.miku.waclient.MUSIC_TOGGLE"
        const val ACTION_STOP = "id.miku.waclient.MUSIC_STOP"
        const val ACTION_NEXT = "id.miku.waclient.MUSIC_NEXT"
        const val ACTION_PREV = "id.miku.waclient.MUSIC_PREV"

        // requestCode unik per aksi PendingIntents
        private const val RC_TOGGLE = 101
        private const val RC_NEXT = 102
        private const val RC_PREV = 103
        private const val RC_STOP = 104

        // Session media aktif (dibuat service, dipakai untuk notifikasi MediaStyle)
        @Volatile
        private var activeSession: MediaSessionCompat? = null

        /** Dipanggil MusicPlayer tiap ada lagu mulai — nyalakan foreground. */
        fun start(context: Context) {
            val intent = Intent(context, MusicService::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /** Dipanggil MusicPlayer saat musik berhenti — matikan service. */
        fun stop(context: Context) {
            context.stopService(Intent(context, MusicService::class.java))
        }

        /** Update isi notifikasi (status/art/thumbnail) dari mana saja. */
        fun refreshStatic(context: Context?) {
            context ?: return
            runCatching {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                nm.notify(NOTIF_ID, buildNotification(context))
            }
        }

        fun statusText(): String = when {
            MusicPlayer.nowPlaying == null -> "Siap memutar musik"
            MusicPlayer.preparing -> "menyiapkan stream..."
            MusicPlayer.isPaused -> "dijeda"
            else -> "memutar"
        }

        fun buildNotification(context: Context): Notification {
            val np = MusicPlayer.nowPlaying
            val contentIntent = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            fun actionPI(action: String, rc: Int): PendingIntent = PendingIntent.getService(
                context,
                rc,
                Intent(context, MusicService::class.java).setAction(action),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            // Sinkronkan MediaSession (metadata + playback state) sebelum build.
            // Media card layar kunci (Android 11+) & progress bar membaca ini.
            activeSession?.let { session -> runCatching { syncSession(session) } }

            val pausePlayTitle = if (MusicPlayer.isPaused) "▶" else "⏸"

            val builder = androidx.core.app.NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notif)
                .setContentIntent(contentIntent)
                .setOnlyAlertOnce(true)
                .setOngoing(np != null && !MusicPlayer.isPaused)
                .setContentTitle(np?.title ?: "MikuWA")
                .setContentText(statusText())
                // 3 tombol tampil di compact: prev, play/pause, next
                .addAction(0, "⏮", actionPI(ACTION_PREV, RC_PREV))
                .addAction(0, pausePlayTitle, actionPI(ACTION_TOGGLE, RC_TOGGLE))
                .addAction(0, "⏭", actionPI(ACTION_NEXT, RC_NEXT))
                .addAction(0, "⏹", actionPI(ACTION_STOP, RC_STOP))
                .setVisibility(androidx.core.app.NotificationCompat.VISIBILITY_PUBLIC)

            val token = activeSession?.sessionToken
            if (token != null) {
                builder.setStyle(
                    MediaStyle()
                        .setMediaSession(token)
                        .setShowActionsInCompactView(0, 1, 2),
                )
            }
            return builder.build()
        }

        /** Isi metadata + state: judul, artis, durasi, album art, posisi. */
        private fun syncSession(session: MediaSessionCompat) {
            val np = MusicPlayer.nowPlaying
            val md = MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, np?.title ?: "MikuWA")
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, MusicPlayer.nowArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "MikuWA Streaming")
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, MusicPlayer.durationSec * 1000L)
                .apply {
                    MusicPlayer.currentArt?.let {
                        putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
                    }
                }
                .build()
            session.setMetadata(md)

            val state = when {
                MusicPlayer.nowPlaying == null -> PlaybackStateCompat.STATE_NONE
                MusicPlayer.preparing -> PlaybackStateCompat.STATE_BUFFERING
                MusicPlayer.isPaused -> PlaybackStateCompat.STATE_PAUSED
                else -> PlaybackStateCompat.STATE_PLAYING
            }
            session.setPlaybackState(
                PlaybackStateCompat.Builder()
                    .setState(state, MusicPlayer.positionSec * 1000L, if (MusicPlayer.isPaused || MusicPlayer.preparing) 0f else 1f)
                    .setActions(
                        PlaybackStateCompat.ACTION_PLAY or
                            PlaybackStateCompat.ACTION_PAUSE or
                            PlaybackStateCompat.ACTION_PLAY_PAUSE or
                            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                            PlaybackStateCompat.ACTION_SEEK_TO or
                            PlaybackStateCompat.ACTION_STOP,
                    )
                    .build(),
            )
        }

        fun createChannel(context: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val channel = android.app.NotificationChannel(
                CHANNEL_ID,
                "Pemutar Musik",
                // IMPORTANCE_LOW: tanpa bunyi & tanpa pop-up, cukup memenuhi
                // syarat foreground service (notifikasi wajib ada).
                android.app.NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Menjaga musik tetap berputar di background"
                setShowBadge(false)
            }
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    private var mediaSession: MediaSessionCompat? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel(this)
        val ms = MediaSessionCompat(this, "MikuWAMusic")
        ms.setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() {
                MusicPlayer.resume()
                refreshStatic(this@MusicService)
            }

            override fun onPause() {
                MusicPlayer.pause()
                refreshStatic(this@MusicService)
            }

            override fun onSkipToNext() {
                MusicPlayer.playNext()
                refreshStatic(this@MusicService)
            }

            override fun onSkipToPrevious() {
                MusicPlayer.playPrevious()
                refreshStatic(this@MusicService)
            }

            override fun onSeekTo(pos: Long) {
                MusicPlayer.seekToMs(pos)
                refreshStatic(this@MusicService)
            }

            override fun onStop() {
                MusicPlayer.stop()
                stopSelf()
            }
        })
        ms.isActive = true
        mediaSession = ms
        activeSession = ms
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Aksi dari tombol notifikasi & tombol headset (media button)
        when (intent?.action) {
            ACTION_TOGGLE -> MusicPlayer.pauseResume()
            ACTION_NEXT -> MusicPlayer.playNext()
            ACTION_PREV -> MusicPlayer.playPrevious()
            ACTION_STOP -> {
                MusicPlayer.stop()
                stopSelf()
                return START_NOT_STICKY
            }
            Intent.ACTION_MEDIA_BUTTON -> {
                val ev: KeyEvent? = if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
                }
                when (ev?.keyCode) {
                    KeyEvent.KEYCODE_MEDIA_PLAY -> MusicPlayer.resume()
                    KeyEvent.KEYCODE_MEDIA_PAUSE -> MusicPlayer.pause()
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> MusicPlayer.pauseResume()
                    KeyEvent.KEYCODE_MEDIA_NEXT -> MusicPlayer.playNext()
                    KeyEvent.KEYCODE_MEDIA_PREVIOUS -> MusicPlayer.playPrevious()
                    KeyEvent.KEYCODE_MEDIA_STOP -> {
                        MusicPlayer.stop()
                        stopSelf()
                        return START_NOT_STICKY
                    }
                }
            }
        }
        startForeground(NOTIF_ID, buildNotification(this))
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        mediaSession?.isActive = false
        mediaSession?.release()
        mediaSession = null
        activeSession = null
        super.onDestroy()
    }
}
