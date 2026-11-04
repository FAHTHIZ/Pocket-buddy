package com.pocketbuddy

import android.app.ActivityManager
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
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
            val storage = StatFs(context.filesDir.absolutePath)
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
}