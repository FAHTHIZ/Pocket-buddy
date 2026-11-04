package com.pocketbuddy

import android.app.ActivityManager
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.io.File
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class PocketBuddyNativeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "PocketBuddyNative"

    @ReactMethod
    fun getDeviceProfile(promise: Promise) {
        try {
            val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val memory = ActivityManager.MemoryInfo()
            activity.getMemoryInfo(memory)
            val downloadDirectory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            val storage = StatFs(downloadDirectory?.absolutePath ?: context.filesDir.absolutePath)
            val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            val result = Arguments.createMap()
            result.putString("manufacturer", Build.MANUFACTURER ?: "Unknown")
            result.putString("model", Build.MODEL ?: "Android device")
            result.putString("soc", if (Build.VERSION.SDK_INT >= 31) Build.SOC_MODEL else Build.HARDWARE)
            result.putInt("sdk", Build.VERSION.SDK_INT)
            result.putDouble("totalRamMb", memory.totalMem / 1048576.0)
            result.putDouble("availableRamMb", memory.availMem / 1048576.0)
            result.putDouble("availableStorageMb", storage.availableBytes / 1048576.0)
            result.putInt("memoryClassMb", activity.memoryClass)
            result.putInt("thermalStatus", if (Build.VERSION.SDK_INT >= 29) power.currentThermalStatus else -1)
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject("DEVICE_PROFILE_FAILED", error)
        }
    }

    @ReactMethod
    fun startDownload(url: String, fileName: String, headers: ReadableMap, promise: Promise) {
        try {
            val uri = Uri.parse(url)
            if (uri.scheme != "https" || uri.host.isNullOrBlank()) {
                promise.reject("INVALID_DOWNLOAD_URL", "Model downloads must use a valid HTTPS URL.")
                return
            }
            val safeName = fileName.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_")
            if (safeName.isBlank()) {
                promise.reject("INVALID_FILE_NAME", "A valid destination filename is required.")
                return
            }
            val request = DownloadManager.Request(uri)
                .setTitle(safeName)
                .setDescription("Downloading model for Pocket Buddy")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)
                .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, safeName)

            val iterator = headers.keySetIterator()
            while (iterator.hasNextKey()) {
                val key = iterator.nextKey()
                val value = headers.getString(key)
                if (!value.isNullOrBlank()) request.addRequestHeader(key, value)
            }
            val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val result = Arguments.createMap()
            result.putString("downloadId", manager.enqueue(request).toString())
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject("DOWNLOAD_START_FAILED", error)
        }
    }

    @ReactMethod
    fun getDownloadStatus(downloadId: String, promise: Promise) {
        try {
            val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val cursor = manager.query(DownloadManager.Query().setFilterById(downloadId.toLong()))
            cursor.use {
                if (it == null || !it.moveToFirst()) {
                    promise.reject("DOWNLOAD_NOT_FOUND", "The system download no longer exists.")
                    return
                }
                val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                val downloaded = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                val result = Arguments.createMap()
                result.putDouble("progress", if (total > 0) downloaded.toDouble() / total.toDouble() else 0.0)
                result.putDouble("bytesDownloaded", downloaded.toDouble())
                result.putDouble("totalBytes", total.toDouble())
                when (status) {
                    DownloadManager.STATUS_SUCCESSFUL -> {
                        result.putString("status", "complete")
                        @Suppress("DEPRECATION")
                        result.putString("localPath", it.getString(it.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_FILENAME)))
                    }
                    DownloadManager.STATUS_FAILED -> {
                        result.putString("status", "failed")
                        result.putInt("reason", it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)))
                    }
                    DownloadManager.STATUS_PAUSED -> result.putString("status", "paused")
                    DownloadManager.STATUS_RUNNING -> result.putString("status", "running")
                    else -> result.putString("status", "queued")
                }
                promise.resolve(result)
            }
        } catch (error: Exception) {
            promise.reject("DOWNLOAD_STATUS_FAILED", error)
        }
    }

    @ReactMethod
    fun cancelDownload(downloadId: String, promise: Promise) {
        try {
            val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            manager.remove(downloadId.toLong())
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("DOWNLOAD_CANCEL_FAILED", error)
        }
    }

    private val speechHandler = Handler(Looper.getMainLooper())
    private var speechEngine: TextToSpeech? = null
    private var speechPlayer: MediaPlayer? = null
    private var speechFile: File? = null
    private var speechPromise: Promise? = null

    private fun finishSpeech(promise: Promise, error: Throwable? = null) {
        if (speechPromise !== promise) return
        speechPromise = null
        try { speechEngine?.shutdown() } catch (_: Exception) {}
        speechEngine = null
        if (error != null) promise.reject("SPEECH_FAILED", error)
        else promise.resolve("completed")
    }

    private fun stopSpeechInternally() {
        try { speechEngine?.stop(); speechEngine?.shutdown() } catch (_: Exception) {}
        speechEngine = null
        try {
            speechPlayer?.setOnCompletionListener(null)
            speechPlayer?.setOnErrorListener(null)
            speechPlayer?.stop()
            speechPlayer?.release()
        } catch (_: Exception) {}
        speechPlayer = null
        try { speechFile?.delete() } catch (_: Exception) {}
        speechFile = null
        speechPromise?.resolve("stopped")
        speechPromise = null
    }

    @ReactMethod
    fun speakSystem(text: String, languageTag: String, promise: Promise) {
        val cleanText = text.trim().take(6000)
        if (cleanText.isBlank()) {
            promise.reject("EMPTY_SPEECH", "There is no message text to read aloud.")
            return
        }
        speechHandler.post {
            stopSpeechInternally()
            speechPromise = promise
            try {
                lateinit var engine: TextToSpeech
                engine = TextToSpeech(context.applicationContext) { status ->
                    if (speechPromise !== promise) {
                        try { engine.shutdown() } catch (_: Exception) {}
                        return@TextToSpeech
                    }
                    if (status != TextToSpeech.SUCCESS) {
                        finishSpeech(promise, IllegalStateException("Android could not initialize its installed speech engine."))
                        return@TextToSpeech
                    }
                    try {
                        val locale = if (languageTag.isBlank()) Locale.getDefault() else Locale.forLanguageTag(languageTag)
                        val languageStatus = engine.setLanguage(locale)
                        if (languageStatus == TextToSpeech.LANG_MISSING_DATA || languageStatus == TextToSpeech.LANG_NOT_SUPPORTED) {
                            finishSpeech(promise, IllegalStateException("The selected language voice is not installed on this device."))
                            return@TextToSpeech
                        }
                        val bestVoice = engine.voices?.filter {
                            it.locale.language == locale.language && (locale.country.isBlank() || it.locale.country == locale.country)
                        }?.maxByOrNull { it.quality }
                        if (bestVoice != null) engine.voice = bestVoice
                        engine.setSpeechRate(0.96f)
                        engine.setPitch(1.0f)
                        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                            override fun onStart(utteranceId: String?) {}
                            override fun onDone(utteranceId: String?) { speechHandler.post { finishSpeech(promise) } }
                            override fun onError(utteranceId: String?) {
                                speechHandler.post { finishSpeech(promise, IllegalStateException("Android speech playback failed.")) }
                            }
                        })
                        speechEngine = engine
                        if (engine.speak(cleanText, TextToSpeech.QUEUE_FLUSH, null, "pocket-buddy-${System.currentTimeMillis()}") == TextToSpeech.ERROR) {
                            finishSpeech(promise, IllegalStateException("Android could not start speech playback."))
                        }
                    } catch (error: Exception) {
                        finishSpeech(promise, error)
                    }
                }
                speechEngine = engine
            } catch (error: Exception) {
                finishSpeech(promise, error)
            }
        }
    }

    @ReactMethod
    fun speakNeural(text: String, apiKey: String, voiceId: String, modelId: String, promise: Promise) {
        val spoken = text.trim().take(6000)
        val secret = apiKey.trim()
        val voice = voiceId.trim()
        val model = modelId.trim().ifBlank { "eleven_multilingual_v2" }
        if (spoken.isBlank()) { promise.reject("EMPTY_SPEECH", "There is no message text to read aloud."); return }
        if (secret.isBlank() || !voice.matches(Regex("[A-Za-z0-9_-]{6,128}"))) {
            promise.reject("VOICE_SETTINGS_REQUIRED", "Add a neural speech API key and voice ID in Settings, or use the built-in phone voice.")
            return
        }
        if (!model.matches(Regex("[A-Za-z0-9_.-]{1,80}"))) {
            promise.reject("INVALID_VOICE_MODEL", "Enter a valid speech model identifier.")
            return
        }
        speechHandler.post { stopSpeechInternally(); speechPromise = promise }
        Thread({
            var connection: HttpsURLConnection? = null
            try {
                val encodedVoice = URLEncoder.encode(voice, "UTF-8").replace("+", "%20")
                connection = URL("https://api.elevenlabs.io/v1/text-to-speech/${encodedVoice}?output_format=mp3_44100_128")
                    .openConnection() as HttpsURLConnection
                connection.requestMethod = "POST"
                connection.connectTimeout = 20000
                connection.readTimeout = 90000
                connection.doOutput = true
                connection.setRequestProperty("xi-api-key", secret)
                connection.setRequestProperty("Accept", "audio/mpeg")
                connection.setRequestProperty("Content-Type", "application/json")
                val body = JSONObject().put("text", spoken).put("model_id", model).put(
                    "voice_settings", JSONObject().put("stability", 0.48).put("similarity_boost", 0.75).put("style", 0.15).put("use_speaker_boost", true)
                )
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val status = connection.responseCode
                if (status !in 200..299) {
                    val detail = try { connection.errorStream?.bufferedReader()?.use { it.readText() } ?: "No error details." }
                    catch (_: Exception) { "No error details." }
                    throw IllegalStateException("Neural speech provider returned HTTP $status: ${detail.take(500)}")
                }
                val audio = File.createTempFile("pocket-buddy-", ".mp3", context.cacheDir)
                connection.inputStream.use { input -> audio.outputStream().use { input.copyTo(it) } }
                if (audio.length() <= 0L) { audio.delete(); throw IllegalStateException("The provider returned an empty audio file.") }
                speechHandler.post { if (speechPromise === promise) playNeuralAudio(audio, promise) else audio.delete() }
            } catch (error: Exception) {
                speechHandler.post { finishSpeech(promise, error) }
            } finally {
                connection?.disconnect()
            }
        }, "PocketBuddyNeuralSpeech").start()
    }

    private fun playNeuralAudio(file: File, promise: Promise) {
        try {
            val player = MediaPlayer()
            speechPlayer = player
            speechFile = file
            player.setOnPreparedListener { it.start() }
            player.setOnCompletionListener {
                it.release()
                if (speechPlayer === it) speechPlayer = null
                if (speechFile == file) speechFile = null
                file.delete()
                finishSpeech(promise)
            }
            player.setOnErrorListener { failed, _, _ ->
                failed.release()
                if (speechPlayer === failed) speechPlayer = null
                if (speechFile == file) speechFile = null
                file.delete()
                finishSpeech(promise, IllegalStateException("Generated speech audio could not be played."))
                true
            }
            player.setDataSource(file.absolutePath)
            player.prepareAsync()
        } catch (error: Exception) {
            file.delete()
            if (speechFile == file) speechFile = null
            finishSpeech(promise, error)
        }
    }

    @ReactMethod
    fun stopSpeaking(promise: Promise) {
        speechHandler.post { stopSpeechInternally(); promise.resolve(true) }
    }
}
