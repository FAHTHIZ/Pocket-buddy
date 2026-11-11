package com.pocketbuddy

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Media helpers for generated images, videos and audio:
 * HTTPS download to app storage, video thumbnails, in-app playback,
 * sharing, opening in other apps and saving to the phone gallery.
 */
class PocketBuddyMediaModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), ActivityEventListener {
    private var chatPickerPromise: Promise? = null
    init { context.addActivityEventListener(this) }
    override fun getName() = "PocketBuddyMedia"

    private val mainHandler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var playerPromise: Promise? = null

    private fun mediaDirectory(): File {
        val directory = File(context.filesDir, "media")
        if (!directory.exists()) directory.mkdirs()
        return directory
    }

    private fun ownedMediaFile(path: String): File? {
        val clean = path.removePrefix("file://")
        val file = File(clean).canonicalFile
        val root = mediaDirectory().canonicalFile
        return if (file.path.startsWith(root.path + File.separator) && file.isFile) file else null
    }

    private fun extensionFor(mime: String, fallback: String): String {
        val type = mime.lowercase()
        return when {
            type.contains("png") -> "png"
            type.contains("webp") -> "webp"
            type.contains("gif") -> "gif"
            type.contains("svg") -> "svg"
            type.contains("jpeg") || type.contains("jpg") -> "jpg"
            type.contains("mp4") -> "mp4"
            type.contains("webm") -> "webm"
            type.contains("quicktime") -> "mov"
            type.contains("mpeg") && type.startsWith("audio") -> "mp3"
            type.contains("mp3") -> "mp3"
            type.contains("wav") -> "wav"
            type.contains("ogg") -> "ogg"
            type.contains("aac") -> "aac"
            type.contains("flac") -> "flac"
            type.contains("opus") -> "opus"
            else -> fallback
        }
    }

    private fun writeThumbnail(video: File): String? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(video.absolutePath)
            val frame = (if (Build.VERSION.SDK_INT >= 27) retriever.getScaledFrameAtTime(400000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 512, 512) ?: retriever.getFrameAtTime(400000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) else retriever.getFrameAtTime(400000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)) ?: retriever.frameAtTime ?: return null
            val thumb = File(video.parentFile, video.nameWithoutExtension + "_thumb.jpg")
            thumb.outputStream().use { frame.compress(Bitmap.CompressFormat.JPEG, 82, it) }
            frame.recycle()
            thumb.absolutePath
        } catch (_: Exception) {
            null
        } finally {
            try { retriever.release() } catch (_: Exception) {}
        }
    }

    @ReactMethod
    fun pickChatAttachment(promise: Promise) {
        if (chatPickerPromise != null) {
            promise.reject("PICKER_BUSY", "A media picker is already open.")
            return
        }
        val activity = currentActivity
        if (activity == null) {
            promise.reject("PICKER_UNAVAILABLE", "Pocket Buddy could not open the Android media picker.")
            return
        }
        try {
            chatPickerPromise = promise
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivityForResult(intent, CHAT_MEDIA_PICKER_REQUEST)
        } catch (error: Exception) {
            chatPickerPromise = null
            promise.reject("PICKER_UNAVAILABLE", "Android could not open the photo/video picker.", error)
        }
    }

    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != CHAT_MEDIA_PICKER_REQUEST) return
        val promise = chatPickerPromise ?: return
        chatPickerPromise = null
        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            promise.resolve(null)
            return
        }
        val source = data.data!!
        Thread({
            var copied: File? = null
            try {
                val resolver = context.contentResolver
                val mime = (resolver.getType(source) ?: "").substringBefore(';').lowercase()
                if (!mime.startsWith("image/") && !mime.startsWith("video/")) {
                    throw IllegalArgumentException("Choose an image or video file.")
                }
                var displayName = "attachment"
                resolver.query(source, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) displayName = cursor.getString(0) ?: displayName
                }
                val safeName = displayName.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_").take(100).ifBlank { "attachment" }
                val extension = extensionFor(mime, safeName.substringAfterLast('.', "bin"))
                val destination = File(mediaDirectory(), "input_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().take(6) + "." + extension)
                copied = destination
                var total = 0L
                resolver.openInputStream(source)?.use { input ->
                    destination.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            if (total > MAX_CHAT_ATTACHMENT_BYTES) throw IllegalArgumentException("This file is over the 120 MB mobile attachment limit.")
                            output.write(buffer, 0, count)
                        }
                    }
                } ?: throw IllegalStateException("Android could not read the selected media file.")
                if (total <= 0L) throw IllegalArgumentException("The selected file is empty.")
                val result = Arguments.createMap()
                result.putString("path", destination.absolutePath)
                result.putString("name", safeName)
                result.putString("mimeType", mime)
                result.putDouble("size", total.toDouble())
                if (mime.startsWith("video/")) writeThumbnail(destination)?.let { result.putString("thumbnail", it) }
                mainHandler.post { promise.resolve(result) }
            } catch (error: Exception) {
                try { copied?.delete() } catch (_: Exception) {}
                mainHandler.post { promise.reject("ATTACHMENT_IMPORT_FAILED", error.message ?: "The selected media could not be imported.", error) }
            }
        }, "PocketBuddyImportChatMedia").start()
    }

    override fun onNewIntent(intent: Intent?) {}

    private fun frameToBase64(bitmap: Bitmap, maxSide: Int): String {
        val largest = maxOf(bitmap.width, bitmap.height)
        val scaled = if (largest > maxSide) {
            val factor = maxSide.toFloat() / largest.toFloat()
            Bitmap.createScaledBitmap(bitmap, (bitmap.width * factor).toInt().coerceAtLeast(1), (bitmap.height * factor).toInt().coerceAtLeast(1), true)
        } else bitmap
        val bytes = java.io.ByteArrayOutputStream().use { stream ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 78, stream)
            stream.toByteArray()
        }
        if (scaled !== bitmap) scaled.recycle()
        bitmap.recycle()
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    @ReactMethod
    fun getVisionFrames(path: String, mimeType: String, promise: Promise) {
        val file = ownedMediaFile(path) ?: run {
            promise.reject("ATTACHMENT_NOT_FOUND", "This attachment is no longer stored on the phone.")
            return
        }
        Thread({
            try {
                val frames = Arguments.createArray()
                if (mimeType.lowercase().startsWith("image/")) {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(file.absolutePath, bounds)
                    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalStateException("Android could not decode this image.")
                    var sample = 1
                    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
                    val bitmap = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
                        ?: throw IllegalStateException("Android could not decode this image.")
                    frames.pushString(frameToBase64(bitmap, 1280))
                } else if (mimeType.lowercase().startsWith("video/")) {
                    val retriever = MediaMetadataRetriever()
                    try {
                        retriever.setDataSource(file.absolutePath)
                        val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
                        for (percent in listOf(15L, 38L, 61L, 84L)) {
                            val timeUs = if (durationMs > 0L) durationMs * 1000L * percent / 100L else (percent / 15L) * 1000000L
                            val frame = (if (Build.VERSION.SDK_INT >= 27) retriever.getScaledFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 768, 768) ?: retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) else retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)) ?: continue
                            frames.pushString(frameToBase64(frame, 768))
                        }
                    } finally {
                        try { retriever.release() } catch (_: Exception) {}
                    }
                }
                if (frames.size() == 0) throw IllegalStateException("No readable frames could be extracted from this media file.")
                mainHandler.post { promise.resolve(frames) }
            } catch (error: Exception) {
                mainHandler.post { promise.reject("VISION_PREPROCESS_FAILED", error.message ?: "Could not prepare the media for visual analysis.", error) }
            }
        }, "PocketBuddyVisionPreprocess").start()
    }

    /**
     * GET or POST an HTTPS URL (or private-LAN HTTP ComfyUI URL). Media responses are written to app storage and
     * returned as {type:'file', path, mimeType, size, thumbnail?}. JSON or text
     * responses (for example async job tickets) are returned as {type:'text', status, body}.
     */
    private fun isPrivateComfyHost(hostname: String): Boolean {
        val host = hostname.lowercase().removePrefix("[").removeSuffix("]").trimEnd('.')
        if (host == "localhost" || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return true
        if (host == "::1" || (host.contains(':') && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")))) return true
        val parts = host.split('.')
        if (parts.size != 4 || parts.any { part ->
            val value = part.toIntOrNull()
            value == null || value !in 0..255 || !part.matches(Regex("\\d{1,3}"))
        }) return false
        val a = parts[0].toInt()
        val b = parts[1].toInt()
        return a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254)
    }

    @ReactMethod
    fun fetchToFile(url: String, method: String, headers: ReadableMap, body: String?, fallbackExtension: String, timeoutMs: Double, promise: Promise) {
        val uri = Uri.parse(url)
        if (uri.host.isNullOrBlank() || (uri.scheme != "https" && !(uri.scheme == "http" && isPrivateComfyHost(uri.host!!)))) {
            promise.reject("INVALID_MEDIA_URL", "Media downloads require HTTPS, except for private-LAN ComfyUI hosts.")
            return
        }
        Thread({
            var connection: HttpURLConnection? = null
            var target: File? = null
            try {
                connection = URL(url).openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = false
                connection.requestMethod = if (method.equals("POST", true)) "POST" else "GET"
                connection.connectTimeout = 30000
                connection.readTimeout = timeoutMs.toInt().coerceIn(15000, 900000)
                connection.setRequestProperty("User-Agent", "PocketBuddy/1.0 (Android)")
                val iterator = headers.keySetIterator()
                while (iterator.hasNextKey()) {
                    val key = iterator.nextKey()
                    val value = headers.getString(key) ?: continue
                    connection.setRequestProperty(key, value)
                }
                if (connection.requestMethod == "POST" && body != null) {
                    connection.doOutput = true
                    connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                }
                val status = connection.responseCode
                val mime = (connection.contentType ?: "").substringBefore(';').trim().lowercase()
                val isMedia = mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/") || mime == "application/octet-stream"
                if (status !in 200..299 || !isMedia) {
                    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                    val text = try { stream?.bufferedReader()?.use { it.readText() } ?: "" } catch (_: Exception) { "" }
                    val result = Arguments.createMap()
                    result.putString("type", "text")
                    result.putInt("status", status)
                    result.putString("mimeType", mime)
                    result.putString("body", text.take(20000))
                    result.putString("retryAfter", connection.getHeaderField("Retry-After") ?: "")
                    promise.resolve(result)
                    return@Thread
                }
                val extension = extensionFor(mime, fallbackExtension.ifBlank { "bin" })
                val output = File(mediaDirectory(), "pb_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().take(8) + "." + extension)
                target = output
                connection.inputStream.use { input -> output.outputStream().use { input.copyTo(it, 64 * 1024) } }
                if (output.length() <= 0L) throw IllegalStateException("The media service returned an empty file.")
                val result = Arguments.createMap()
                result.putString("type", "file")
                result.putInt("status", status)
                result.putString("path", output.absolutePath)
                result.putString("mimeType", if (mime == "application/octet-stream") "" else mime)
                result.putDouble("size", output.length().toDouble())
                if (mime.startsWith("video/")) writeThumbnail(output)?.let { result.putString("thumbnail", it) }
                promise.resolve(result)
            } catch (error: Exception) {
                try { target?.delete() } catch (_: Exception) {}
                val message = if (error is java.net.SocketTimeoutException) "The media service took too long to respond." else (error.message ?: error.toString())
                promise.reject("MEDIA_FETCH_FAILED", message, error)
            } finally {
                connection?.disconnect()
            }
        }, "PocketBuddyMediaFetch").start()
    }

    @ReactMethod
    fun deleteMedia(path: String, promise: Promise) {
        val file = ownedMediaFile(path)
        if (file == null) { promise.resolve(false); return }
        File(file.parentFile, file.nameWithoutExtension + "_thumb.jpg").delete()
        promise.resolve(file.delete())
    }

    private fun contentUri(file: File): Uri = FileProvider.getUriForFile(context, context.packageName + ".media", file)

    @ReactMethod
    fun openMedia(path: String, mimeType: String, promise: Promise) {
        val file = ownedMediaFile(path) ?: run { promise.reject("MEDIA_NOT_FOUND", "This media file is no longer on the phone."); return }
        try {
            val intent = Intent(Intent.ACTION_VIEW).setDataAndType(contentUri(file), mimeType.ifBlank { "*/*" })
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(Intent.createChooser(intent, "Open with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("OPEN_FAILED", "No app on this phone can open this file.", error)
        }
    }

    @ReactMethod
    fun playVideo(path: String, title: String, promise: Promise) {
        val file = ownedMediaFile(path) ?: run { promise.reject("MEDIA_NOT_FOUND", "This video is no longer on the phone."); return }
        try {
            val intent = Intent(context, VideoPlayerActivity::class.java)
                .putExtra(VideoPlayerActivity.EXTRA_PATH, file.absolutePath)
                .putExtra(VideoPlayerActivity.EXTRA_TITLE, title.take(200))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("PLAY_FAILED", error.message ?: "The video could not be played.", error)
        }
    }

    @ReactMethod
    fun shareMedia(path: String, mimeType: String, promise: Promise) {
        val file = ownedMediaFile(path) ?: run { promise.reject("MEDIA_NOT_FOUND", "This media file is no longer on the phone."); return }
        try {
            val intent = Intent(Intent.ACTION_SEND).setType(mimeType.ifBlank { "*/*" })
                .putExtra(Intent.EXTRA_STREAM, contentUri(file))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            context.startActivity(Intent.createChooser(intent, "Share").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("SHARE_FAILED", error.message ?: "Sharing failed.", error)
        }
    }

    /** Copies a generated file into the public gallery (Pictures, Movies or Music / Pocket Buddy). */
    @ReactMethod
    fun saveToGallery(path: String, mimeType: String, promise: Promise) {
        val file = ownedMediaFile(path) ?: run { promise.reject("MEDIA_NOT_FOUND", "This media file is no longer on the phone."); return }
        Thread({
            try {
                val mime = mimeType.ifBlank { "application/octet-stream" }
                val isVideo = mime.startsWith("video/")
                val isAudio = mime.startsWith("audio/")
                val name = "PocketBuddy_" + System.currentTimeMillis() + "." + file.extension
                if (Build.VERSION.SDK_INT >= 29) {
                    val collection = when {
                        isVideo -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        isAudio -> MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        else -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    }
                    val folder = (if (isVideo) Environment.DIRECTORY_MOVIES else if (isAudio) Environment.DIRECTORY_MUSIC else Environment.DIRECTORY_PICTURES) + "/Pocket Buddy"
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                        put(MediaStore.MediaColumns.MIME_TYPE, mime)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                    val resolver = context.contentResolver
                    val item = resolver.insert(collection, values) ?: throw IllegalStateException("The gallery refused the file.")
                    resolver.openOutputStream(item)?.use { out -> FileInputStream(file).use { it.copyTo(out) } }
                        ?: throw IllegalStateException("Could not write to the gallery.")
                    values.clear()
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    resolver.update(item, values, null, null)
                    promise.resolve(folder)
                } else {
                    @Suppress("DEPRECATION")
                    val base = Environment.getExternalStoragePublicDirectory(if (isVideo) Environment.DIRECTORY_MOVIES else if (isAudio) Environment.DIRECTORY_MUSIC else Environment.DIRECTORY_PICTURES)
                    val folder = File(base, "Pocket Buddy")
                    folder.mkdirs()
                    val target = File(folder, name)
                    file.copyTo(target, overwrite = true)
                    MediaScannerConnection.scanFile(context, arrayOf(target.absolutePath), arrayOf(mime), null)
                    promise.resolve(target.parent)
                }
            } catch (error: Exception) {
                promise.reject("SAVE_FAILED", error.message ?: "Saving to the gallery failed.", error)
            }
        }, "PocketBuddySaveMedia").start()
    }

    private fun releasePlayer(result: String) {
        try {
            player?.setOnCompletionListener(null)
            player?.setOnErrorListener(null)
            player?.stop()
        } catch (_: Exception) {}
        try { player?.release() } catch (_: Exception) {}
        player = null
        playerPromise?.resolve(result)
        playerPromise = null
    }

    /** Plays an audio file in the app. Resolves when playback completes or is stopped. */
    @ReactMethod
    fun playAudio(path: String, promise: Promise) {
        val file = ownedMediaFile(path) ?: run { promise.reject("MEDIA_NOT_FOUND", "This audio file is no longer on the phone."); return }
        mainHandler.post {
            releasePlayer("stopped")
            try {
                val next = MediaPlayer()
                player = next
                playerPromise = promise
                next.setOnPreparedListener { it.start() }
                next.setOnCompletionListener { if (player === it) releasePlayer("completed") }
                next.setOnErrorListener { failed, _, _ ->
                    if (player === failed) {
                        player = null
                        try { failed.release() } catch (_: Exception) {}
                        playerPromise?.reject("PLAYBACK_FAILED", "This audio could not be played.")
                        playerPromise = null
                    }
                    true
                }
                next.setDataSource(file.absolutePath)
                next.prepareAsync()
            } catch (error: Exception) {
                player = null
                playerPromise = null
                promise.reject("PLAYBACK_FAILED", error.message ?: "This audio could not be played.", error)
            }
        }
    }

    @ReactMethod
    fun stopAudio(promise: Promise) {
        mainHandler.post { releasePlayer("stopped"); promise.resolve(true) }
    }

    override fun invalidate() {
        mainHandler.post { releasePlayer("stopped") }
        val pending = chatPickerPromise
        chatPickerPromise = null
        pending?.reject("PICKER_CLOSED", "The media picker was closed with Pocket Buddy.")
        super.invalidate()
    }

    companion object {
        private const val CHAT_MEDIA_PICKER_REQUEST = 7314
        private const val MAX_CHAT_ATTACHMENT_BYTES = 120L * 1024L * 1024L
    }
}
