package com.pocketbuddy

import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.ServerSocket
import java.security.SecureRandom
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Optional MoE expert-streaming backend. Runs BigMoeOnEdge's bmoe-server (Apache-2.0, a llama.cpp
 * fork) as a child process bound to loopback with a random API key, exactly like the upstream
 * Android app. Being a separate process means a native crash or the low-memory killer ends the
 * engine, never Pocket Buddy's UI, and its memory is returned to Android the moment it stops.
 */
class PocketBuddyMoeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "PocketBuddyMoE"

    @Volatile private var process: Process? = null
    @Volatile private var port = 0
    @Volatile private var apiKey = ""
    @Volatile private var exitCode: Int? = null
    private val tail = StringBuilder()

    private fun nativeDir() = context.applicationInfo.nativeLibraryDir
    private fun serverFile() = File(nativeDir(), "libbmoe-server.so")

    private fun available(): Pair<Boolean, String> = when {
        !Build.SUPPORTED_64_BIT_ABIS.contains("arm64-v8a") -> false to "MoE streaming engine needs an ARM64 phone."
        Build.VERSION.SDK_INT < 29 -> false to "MoE streaming engine needs Android 10 or newer."
        !serverFile().exists() -> false to "This build does not include the MoE streaming engine."
        else -> true to "ready"
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        val (ok, reason) = available()
        val result = Arguments.createMap()
        result.putBoolean("available", ok)
        result.putString("reason", reason)
        result.putBoolean("running", process?.isAlive == true)
        promise.resolve(result)
    }

    private fun freePort(): Int = ServerSocket(0).use { it.localPort }

    private fun randomKey(): String {
        val bytes = ByteArray(24); SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    @ReactMethod
    fun start(modelPath: String, engineArgs: ReadableArray, promise: Promise) {
        thread(name = "pb-moe-start") {
            try {
                val (ok, reason) = available()
                if (!ok) throw IllegalStateException(reason)
                stopBlocking()
                val model = File(modelPath.removePrefix("file://"))
                if (!model.exists()) throw IllegalArgumentException("Model file not found")
                val dataDir = File(context.filesDir, "bmoe").apply { mkdirs() }
                val modelsDir = File(dataDir, "models").apply { mkdirs() }
                val routingDir = File(dataDir, "routing").apply { mkdirs() }
                val catalog = File(dataDir, "catalog.json")
                catalog.writeText("{\"version\":1,\"about\":\"Pocket Buddy\",\"models\":[]}")
                val key = randomKey()
                val keyFile = File(context.noBackupFilesDir, "bmoe-api-key")
                keyFile.writeText(key)
                keyFile.setReadable(false, false); keyFile.setReadable(true, true)
                keyFile.setWritable(false, false); keyFile.setWritable(true, true)
                val logFile = File(dataDir, "server.log")
                val chosenPort = freePort()
                val argv = mutableListOf(
                    serverFile().absolutePath,
                    "--host", "127.0.0.1", "--port", chosenPort.toString(),
                    "--data-dir", dataDir.absolutePath,
                    "--models-dir", modelsDir.absolutePath,
                    "--scan-dir", model.parentFile?.absolutePath ?: modelsDir.absolutePath,
                    "--catalog", catalog.absolutePath,
                    "--api-key-file", keyFile.absolutePath,
                    "--chat-only",
                    "--parent-pid", android.os.Process.myPid().toString(),
                    "-m", model.absolutePath,
                )
                for (i in 0 until engineArgs.size()) {
                    val arg = engineArgs.getString(i) ?: continue
                    argv += arg.replace("{routingDir}", routingDir.absolutePath)
                }
                val builder = ProcessBuilder(argv)
                builder.environment()["LD_LIBRARY_PATH"] = nativeDir() + ":/system/lib64:/vendor/lib64"
                builder.environment()["ADSP_LIBRARY_PATH"] = nativeDir()
                builder.directory(dataDir)
                builder.redirectErrorStream(true)
                synchronized(tail) { tail.setLength(0); tail.append("$ ").append(argv.drop(1).joinToString(" ")).append('\n') }
                exitCode = null
                val started = builder.start()
                process = started; port = chosenPort; apiKey = key
                thread(name = "pb-moe-log") {
                    try {
                        BufferedReader(InputStreamReader(started.inputStream)).forEachLine { line ->
                            synchronized(tail) {
                                tail.append(line).append('\n')
                                if (tail.length > 24000) tail.delete(0, tail.length - 16000)
                            }
                        }
                    } catch (_: Throwable) {}
                    val code = runCatching { started.waitFor() }.getOrDefault(-1)
                    if (process === started) { process = null; exitCode = code }
                }
                val result = Arguments.createMap()
                result.putInt("port", chosenPort)
                result.putString("apiKey", key)
                result.putString("baseUrl", "http://127.0.0.1:$chosenPort")
                promise.resolve(result)
            } catch (error: Throwable) {
                promise.reject("MOE_START_FAILED", error.message, error)
            }
        }
    }

    private fun stopBlocking() {
        val p = process ?: return
        process = null
        runCatching { p.destroy() }
        runCatching {
            if (!p.waitFor(3, TimeUnit.SECONDS)) { p.destroyForcibly(); p.waitFor(2, TimeUnit.SECONDS) }
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        thread(name = "pb-moe-stop") { stopBlocking(); promise.resolve(true) }
    }

    @ReactMethod
    fun status(promise: Promise) {
        val result = Arguments.createMap()
        val p = process
        result.putBoolean("running", p?.isAlive == true)
        result.putInt("port", port)
        exitCode?.let { result.putInt("exitCode", it) }
        // Resident memory of the engine process, which is what Android's low-memory killer weighs.
        var rss = 0.0
        if (p != null && p.isAlive) {
            runCatching {
                val pidField = p.javaClass.getDeclaredField("pid"); pidField.isAccessible = true
                val pid = pidField.getInt(p)
                File("/proc/$pid/status").forEachLine { line ->
                    if (line.startsWith("VmRSS:")) rss = (line.split(Regex("\\s+")).getOrNull(1)?.toDoubleOrNull() ?: 0.0) / 1024.0
                }
            }
        }
        result.putDouble("rssMb", rss)
        promise.resolve(result)
    }

    @ReactMethod
    fun readLog(promise: Promise) {
        promise.resolve(synchronized(tail) { tail.toString() })
    }

    override fun invalidate() {
        stopBlocking()
        super.invalidate()
    }
}
