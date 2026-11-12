package com.pocketbuddy

import android.os.Build
import android.os.Environment
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * On-device image and video generation with stable-diffusion.cpp (MIT).
 *
 * The engine is a standalone sd-cli executable shipped as lib*.so in nativeLibraryDir, run as a
 * child process (like the MoE engine). A native crash or the low-memory killer therefore ends only
 * the generation, never the app, and all of its memory returns to Android when it exits.
 *
 * Two builds are bundled: an ARMv8.2 build with dot-product and FP16 instructions (Helio G85,
 * Snapdragon 7xx/8xx and most phones since 2018) and a baseline ARMv8.0 build for older chips.
 */
class PocketBuddyDiffusionModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "PocketBuddyDiffusion"

    @Volatile private var process: Process? = null
    @Volatile private var cancelled = false
    private var listeners = 0

    private fun nativeDir() = File(context.applicationInfo.nativeLibraryDir)

    private fun cpuFeatures(): Set<String> = try {
        File("/proc/cpuinfo").readLines()
            .filter { it.startsWith("Features") }
            .flatMap { it.substringAfter(':').trim().split(Regex("\\s+")) }
            .toSet()
    } catch (_: Exception) { emptySet() }

    private fun engine(): Pair<File?, String> {
        if (!Build.SUPPORTED_64_BIT_ABIS.contains("arm64-v8a")) return null to "On-device image generation needs an ARM64 phone."
        val features = cpuFeatures()
        val fast = File(nativeDir(), "libsdcli.so")
        val compat = File(nativeDir(), "libsdcli_compat.so")
        if (features.contains("asimddp") && features.contains("fphp") && fast.exists()) return fast to "armv8.2-dotprod-fp16"
        if (compat.exists()) return compat to "armv8.0"
        if (fast.exists()) return null to "This phone's processor is too old for the bundled image engine."
        return null to "This build does not include the on-device image engine."
    }

    private fun mediaDirectory(): File = File(context.filesDir, "media").apply { if (!exists()) mkdirs() }

    private fun allowedModel(path: String): File? {
        val file = File(path.removePrefix("file://")).canonicalFile
        val roots = listOfNotNull(
            context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.canonicalFile,
            context.filesDir.canonicalFile
        )
        return if (file.isFile && roots.any { file.path.startsWith(it.path + File.separator) }) file else null
    }

    private fun emit(event: WritableMap) {
        try {
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("PocketBuddyDiffusionProgress", event)
        } catch (_: Exception) {}
    }

    @ReactMethod fun addListener(eventName: String) { listeners++ }
    @ReactMethod fun removeListeners(count: Double) { listeners = maxOf(0, listeners - count.toInt()) }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        val (file, detail) = engine()
        val result = Arguments.createMap()
        result.putBoolean("available", file != null)
        result.putString("detail", detail)
        result.putInt("cores", Runtime.getRuntime().availableProcessors())
        result.putBoolean("running", process?.isAlive == true)
        promise.resolve(result)
    }

    private fun bigCoreCount(): Int {
        val cores = Runtime.getRuntime().availableProcessors()
        val freqs = (0 until cores).map { cpu ->
            try { File("/sys/devices/system/cpu/cpu$cpu/cpufreq/cpuinfo_max_freq").readText().trim().toLong() } catch (_: Exception) { 0L }
        }
        val top = freqs.maxOrNull() ?: 0L
        if (top <= 0L) return cores
        // Cores within 85% of the fastest clock are treated as performance cores.
        return freqs.count { it >= top * 85 / 100 }.coerceAtLeast(1)
    }

    /**
     * options: mode ("img"|"vid"), model, vae?, taesd?, t5xxl?, clipL?, prompt, negative, width, height,
     * steps, cfg, sampler, scheduler?, seed, threads (0 = auto), frames?, flowShift?, vaeTiling?,
     * initImage?, strength?, jobId.
     */
    @ReactMethod
    fun generate(options: ReadableMap, promise: Promise) {
        if (process?.isAlive == true) {
            promise.reject("ENGINE_BUSY", "Another on-device generation is still running.")
            return
        }
        thread(name = "pb-diffusion") {
            var outFile: File? = null
            val jobId = if (options.hasKey("jobId")) options.getString("jobId") ?: "" else ""
            try {
                val (binary, detail) = engine()
                if (binary == null) throw IllegalStateException(detail)
                val mode = if (options.hasKey("mode")) options.getString("mode") ?: "img" else "img"
                val modelPath = options.getString("model") ?: throw IllegalArgumentException("No model selected.")
                val model = allowedModel(modelPath) ?: throw IllegalArgumentException("The selected model file is missing. Download it again from Models.")
                val prompt = options.getString("prompt")?.take(2000) ?: ""
                if (prompt.isBlank()) throw IllegalArgumentException("Describe what you want to create.")
                val negative = if (options.hasKey("negative")) options.getString("negative") ?: "" else ""
                val width = options.getInt("width").coerceIn(128, 1024) / 64 * 64
                val height = options.getInt("height").coerceIn(128, 1024) / 64 * 64
                val steps = options.getInt("steps").coerceIn(1, 60)
                val cfg = options.getDouble("cfg").coerceIn(0.0, 20.0)
                val seed = if (options.hasKey("seed")) options.getDouble("seed").toLong() else -1L
                val requestedThreads = if (options.hasKey("threads")) options.getInt("threads") else 0
                val threads = if (requestedThreads > 0) requestedThreads else bigCoreCount().let { big ->
                    val cores = Runtime.getRuntime().availableProcessors()
                    // big.LITTLE phones: use every core, but never more than 8 threads.
                    if (cores >= 8) minOf(8, cores) else maxOf(big, cores)
                }
                val isVideo = mode == "vid"
                val extension = if (isVideo) "avi" else "png"
                val out = File(mediaDirectory(), (if (isVideo) "local_vid_" else "local_img_") + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().take(6) + "." + extension)
                outFile = out

                val argv = mutableListOf(binary.absolutePath)
                if (isVideo) {
                    argv += listOf("-M", "vid_gen", "--diffusion-model", model.path)
                } else {
                    argv += listOf("-m", model.path)
                }
                fun optionalFile(key: String, flag: String) {
                    if (options.hasKey(key)) {
                        val raw = options.getString(key) ?: return
                        if (raw.isBlank()) return
                        val file = allowedModel(raw) ?: throw IllegalArgumentException("A required companion file ($key) is missing. Download the model again.")
                        argv += listOf(flag, file.path)
                    }
                }
                optionalFile("vae", "--vae")
                optionalFile("taesd", "--taesd")
                optionalFile("t5xxl", "--t5xxl")
                optionalFile("clipL", "--clip_l")
                optionalFile("initImage", "--init-img")
                argv += listOf(
                    "-p", prompt,
                    "-W", width.toString(), "-H", height.toString(),
                    "--steps", steps.toString(),
                    "--cfg-scale", String.format(java.util.Locale.US, "%.2f", cfg),
                    "-s", seed.toString(),
                    "-t", threads.toString(),
                    "-o", out.path
                )
                if (negative.isNotBlank()) argv += listOf("-n", negative.take(1000))
                if (options.hasKey("sampler")) options.getString("sampler")?.takeIf { it.isNotBlank() }?.let { argv += listOf("--sampling-method", it) }
                if (options.hasKey("scheduler")) options.getString("scheduler")?.takeIf { it.isNotBlank() }?.let { argv += listOf("--scheduler", it) }
                if (options.hasKey("strength")) argv += listOf("--strength", String.format(java.util.Locale.US, "%.2f", options.getDouble("strength").coerceIn(0.05, 1.0)))
                if (isVideo) {
                    val frames = if (options.hasKey("frames")) options.getInt("frames").coerceIn(5, 81) else 17
                    argv += listOf("--video-frames", frames.toString())
                    if (options.hasKey("flowShift")) argv += listOf("--flow-shift", String.format(java.util.Locale.US, "%.2f", options.getDouble("flowShift")))
                    if (options.hasKey("fps")) argv += listOf("--fps", options.getInt("fps").coerceIn(4, 30).toString())
                }
                if (!options.hasKey("vaeTiling") || options.getBoolean("vaeTiling")) argv += "--vae-tiling"
                // Memory-map weights so Android can page them out instead of killing the process.
                argv += "--mmap"

                cancelled = false
                val builder = ProcessBuilder(argv)
                    .directory(context.cacheDir)
                    .redirectErrorStream(true)
                builder.environment()["LD_LIBRARY_PATH"] = nativeDir().absolutePath
                val started = System.currentTimeMillis()
                val child = builder.start()
                process = child
                child.outputStream.close()

                val tail = ArrayDeque<String>()
                val line = StringBuilder()
                var phase = "loading"
                val stepRegex = Regex("(\\d+)/(\\d+)\\s*-\\s*([\\d.]+)(s/it|it/s)")
                var lastEmit = 0L
                fun handle(text: String) {
                    val trimmed = text.trim()
                    if (trimmed.isEmpty()) return
                    if (!trimmed.startsWith("|")) { tail.addLast(trimmed.take(300)); while (tail.size > 25) tail.removeFirst() }
                    val lower = trimmed.lowercase()
                    // Phases only move forward; load-time lines such as "using VAE for encoding / decoding" are ignored.
                    val next = when {
                        lower.contains("sampling completed") || lower.contains("decode_first_stage") || lower.contains("decoding ") && lower.contains("latent") -> "decoding"
                        lower.contains("sampling using") || lower.contains("sampling(") -> "sampling"
                        lower.contains("get_learned_condition") -> "encoding"
                        else -> phase
                    }
                    val order = listOf("loading", "encoding", "sampling", "decoding")
                    if (order.indexOf(next) > order.indexOf(phase)) phase = next
                    val match = stepRegex.find(trimmed)
                    val now = System.currentTimeMillis()
                    if (match != null || now - lastEmit > 1500) {
                        lastEmit = now
                        val event = Arguments.createMap()
                        event.putString("jobId", jobId)
                        event.putString("phase", phase)
                        event.putDouble("elapsedMs", (now - started).toDouble())
                        if (match != null && phase == "sampling") {
                            event.putInt("step", match.groupValues[1].toInt())
                            event.putInt("total", match.groupValues[2].toInt())
                            val value = match.groupValues[3].toDoubleOrNull() ?: 0.0
                            event.putDouble("secondsPerStep", if (match.groupValues[4] == "it/s" && value > 0) 1.0 / value else value)
                        }
                        emit(event)
                    }
                }
                child.inputStream.bufferedReader().use { reader ->
                    while (true) {
                        val c = reader.read()
                        if (c < 0) break
                        val ch = c.toChar()
                        if (ch == '\n' || ch == '\r') { handle(line.toString()); line.setLength(0) } else if (line.length < 4000) line.append(ch)
                    }
                    if (line.isNotEmpty()) handle(line.toString())
                }
                child.waitFor(30, TimeUnit.SECONDS)
                val code = try { child.exitValue() } catch (_: Exception) { child.destroyForcibly(); -1 }
                process = null
                if (cancelled) throw InterruptedException("Generation cancelled.")
                if (code != 0 || !out.exists() || out.length() == 0L) {
                    val reason = tail.toList().takeLast(6).joinToString("\n")
                    val killed = code == 137 || code == 9 || code == -1
                    throw IllegalStateException(
                        if (killed) "Android stopped the image engine, usually because the phone ran out of memory. Close other apps or pick a smaller size.\n$reason"
                        else "The image engine exited with code $code.\n$reason"
                    )
                }
                val result = Arguments.createMap()
                result.putString("path", out.absolutePath)
                result.putString("mimeType", if (isVideo) "video/x-msvideo" else "image/png")
                result.putDouble("size", out.length().toDouble())
                result.putDouble("elapsedMs", (System.currentTimeMillis() - started).toDouble())
                result.putInt("threads", threads)
                result.putString("engine", detail)
                promise.resolve(result)
            } catch (error: InterruptedException) {
                process = null
                outFile?.delete()
                promise.reject("CANCELLED", "Generation cancelled.")
            } catch (error: Exception) {
                process = null
                outFile?.delete()
                promise.reject("GENERATION_FAILED", error.message ?: "On-device generation failed.", error)
            }
        }
    }

    @ReactMethod
    fun cancel(promise: Promise) {
        val running = process
        if (running == null) { promise.resolve(false); return }
        cancelled = true
        thread(name = "pb-diffusion-cancel") {
            try {
                running.destroy()
                if (!running.waitFor(3, TimeUnit.SECONDS)) running.destroyForcibly()
            } catch (_: Exception) {}
            promise.resolve(true)
        }
    }

    override fun invalidate() {
        try { process?.destroyForcibly() } catch (_: Exception) {}
        process = null
        super.invalidate()
    }
}
