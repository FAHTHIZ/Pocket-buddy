package com.pocketbuddy

import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.GLES20
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.StatFs
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.random.Random

/**
 * Capability detection for the adaptive inference engine. Everything here is measured or read from
 * the kernel/framework at runtime; nothing is keyed on device or SoC names.
 */
class PocketBuddyHardwareModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "PocketBuddyHardware"

    private var listeners = 0
    private var thermalListener: Any? = null
    private val trimCallbacks = object : ComponentCallbacks2 {
        override fun onTrimMemory(level: Int) {
            val event = Arguments.createMap()
            event.putString("type", "trimMemory")
            event.putInt("level", level)
            event.putDouble("availableRamMb", memoryInfo().availMem / MB)
            emit(event)
        }
        override fun onConfigurationChanged(newConfig: Configuration) {}
        @Deprecated("Deprecated in Android")
        override fun onLowMemory() {
            val event = Arguments.createMap()
            event.putString("type", "lowMemory")
            event.putDouble("availableRamMb", memoryInfo().availMem / MB)
            emit(event)
        }
    }

    private fun emit(event: WritableMap) {
        if (listeners <= 0) return
        try {
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("PocketBuddyHardwareEvent", event)
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun addListener(eventName: String) {
        listeners += 1
        if (listeners == 1) {
            context.applicationContext.registerComponentCallbacks(trimCallbacks)
            if (Build.VERSION.SDK_INT >= 29) {
                val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                val listener = PowerManager.OnThermalStatusChangedListener { status ->
                    val event = Arguments.createMap()
                    event.putString("type", "thermal")
                    event.putInt("thermalStatus", status)
                    emit(event)
                }
                try { power.addThermalStatusListener(context.mainExecutor, listener); thermalListener = listener } catch (_: Exception) {}
            }
        }
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        listeners = (listeners - count.toInt()).coerceAtLeast(0)
        if (listeners == 0) {
            try { context.applicationContext.unregisterComponentCallbacks(trimCallbacks) } catch (_: Exception) {}
            if (Build.VERSION.SDK_INT >= 29) {
                val listener = thermalListener as? PowerManager.OnThermalStatusChangedListener
                if (listener != null) {
                    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                    try { power.removeThermalStatusListener(listener) } catch (_: Exception) {}
                }
            }
            thermalListener = null
        }
    }

    private fun memoryInfo(): ActivityManager.MemoryInfo {
        val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo()
        activity.getMemoryInfo(info)
        return info
    }

    private fun readText(path: String): String? = try { File(path).readText().trim() } catch (_: Exception) { null }

    private fun meminfo(): Map<String, Long> {
        val out = HashMap<String, Long>()
        try {
            File("/proc/meminfo").forEachLine { line ->
                val parts = line.split(Regex("\\s+"))
                if (parts.size >= 2) parts[1].toLongOrNull()?.let { out[parts[0].trimEnd(':')] = it }
            }
        } catch (_: Exception) {}
        return out
    }

    private fun processStatus(): Map<String, Long> {
        val out = HashMap<String, Long>()
        try {
            File("/proc/self/status").forEachLine { line ->
                if (line.startsWith("Vm")) {
                    val parts = line.split(Regex("\\s+"))
                    if (parts.size >= 2) parts[1].toLongOrNull()?.let { out[parts[0].trimEnd(':')] = it }
                }
            }
        } catch (_: Exception) {}
        return out
    }

    private fun coreName(part: Int): String = when (part) {
        0xd03 -> "Cortex-A53"; 0xd04 -> "Cortex-A35"; 0xd05 -> "Cortex-A55"; 0xd07 -> "Cortex-A57"
        0xd08 -> "Cortex-A72"; 0xd09 -> "Cortex-A73"; 0xd0a -> "Cortex-A75"; 0xd0b -> "Cortex-A76"
        0xd0d -> "Cortex-A77"; 0xd41 -> "Cortex-A78"; 0xd44 -> "Cortex-X1"; 0xd46 -> "Cortex-A510"
        0xd47 -> "Cortex-A710"; 0xd48 -> "Cortex-X2"; 0xd4d -> "Cortex-A715"; 0xd4e -> "Cortex-X3"
        0xd80 -> "Cortex-A520"; 0xd81 -> "Cortex-A720"; 0xd82 -> "Cortex-X4"; 0xd85 -> "Cortex-X925"
        0xd87 -> "Cortex-A725"; 0xd8a -> "C1-Ultra"; 0xd8b -> "C1-Pro"
        else -> if (part > 0) "CPU part 0x" + Integer.toHexString(part) else "Unknown core"
    }

    private fun cpuInfo(): WritableMap {
        val result = Arguments.createMap()
        val count = Runtime.getRuntime().availableProcessors()
        val possible = readText("/sys/devices/system/cpu/possible")
        val total = possible?.substringAfterLast('-')?.toIntOrNull()?.plus(1) ?: count
        val features = HashSet<String>()
        val parts = HashMap<Int, Int>()
        var currentCpu = -1
        try {
            File("/proc/cpuinfo").forEachLine { line ->
                val key = line.substringBefore(':').trim().lowercase()
                val value = line.substringAfter(':', "").trim()
                when (key) {
                    "processor" -> currentCpu = value.toIntOrNull() ?: -1
                    "features" -> features.addAll(value.split(Regex("\\s+")).filter { it.isNotBlank() })
                    "cpu part" -> if (currentCpu >= 0) parts[currentCpu] = value.removePrefix("0x").toIntOrNull(16) ?: 0
                }
            }
        } catch (_: Exception) {}
        val cores = Arguments.createArray()
        val clusters = LinkedHashMap<Long, MutableList<Int>>()
        for (cpu in 0 until total) {
            val maxKhz = readText("/sys/devices/system/cpu/cpu$cpu/cpufreq/cpuinfo_max_freq")?.toLongOrNull() ?: 0L
            val core = Arguments.createMap()
            core.putInt("id", cpu)
            core.putDouble("maxMhz", maxKhz / 1000.0)
            core.putString("name", coreName(parts[cpu] ?: 0))
            cores.pushMap(core)
            clusters.getOrPut(maxKhz) { ArrayList() }.add(cpu)
        }
        val clusterArray = Arguments.createArray()
        clusters.entries.sortedByDescending { it.key }.forEach { (freq, ids) ->
            val cluster = Arguments.createMap()
            cluster.putDouble("maxMhz", freq / 1000.0)
            cluster.putInt("count", ids.size)
            cluster.putString("name", coreName(parts[ids.first()] ?: 0))
            clusterArray.pushMap(cluster)
        }
        val featureArray = Arguments.createArray()
        features.sorted().forEach { featureArray.pushString(it) }
        result.putInt("cores", total)
        result.putInt("onlineCores", count)
        result.putArray("coreList", cores)
        result.putArray("clusters", clusterArray)
        result.putArray("features", featureArray)
        result.putBoolean("neon", features.contains("asimd") || Build.SUPPORTED_ABIS.contains("arm64-v8a"))
        result.putBoolean("dotprod", features.contains("asimddp"))
        result.putBoolean("fp16", features.contains("fphp") && features.contains("asimdhp"))
        result.putBoolean("i8mm", features.contains("i8mm"))
        result.putBoolean("sve", features.contains("sve"))
        result.putBoolean("sve2", features.contains("sve2"))
        result.putBoolean("bf16", features.contains("bf16"))
        result.putBoolean("sme", features.contains("sme"))
        return result
    }

    private fun storageInfo(): WritableMap {
        val result = Arguments.createMap()
        val block = File("/sys/block")
        val names = try { block.list()?.toList() ?: emptyList() } catch (_: Exception) { emptyList<String>() }
        val kind = when {
            names.any { it.startsWith("sd") } && File("/sys/class/ufs").exists() -> "ufs"
            names.any { it.startsWith("sd") } && names.none { it.startsWith("mmcblk0") } -> "ufs"
            names.any { it == "mmcblk0" } -> "emmc"
            names.any { it.startsWith("nvme") } -> "nvme"
            else -> "unknown"
        }
        val dir = context.getExternalFilesDir(null) ?: context.filesDir
        val stat = StatFs(dir.absolutePath)
        result.putString("kind", kind)
        result.putDouble("freeMb", stat.availableBytes / MB)
        result.putDouble("totalMb", stat.totalBytes / MB)
        return result
    }

    private fun gpuInfo(): WritableMap {
        val result = Arguments.createMap()
        var renderer = ""
        var vendor = ""
        try {
            val display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            val version = IntArray(2)
            if (EGL14.eglInitialize(display, version, 0, version, 1)) {
                val configs = arrayOfNulls<EGLConfig>(1)
                val count = IntArray(1)
                val attrs = intArrayOf(EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT, EGL14.EGL_NONE)
                EGL14.eglChooseConfig(display, attrs, 0, configs, 0, 1, count, 0)
                if (count[0] > 0) {
                    val ctx = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
                    val surface = EGL14.eglCreatePbufferSurface(display, configs[0], intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
                    if (EGL14.eglMakeCurrent(display, surface, surface, ctx)) {
                        renderer = GLES20.glGetString(GLES20.GL_RENDERER) ?: ""
                        vendor = GLES20.glGetString(GLES20.GL_VENDOR) ?: ""
                    }
                    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                    EGL14.eglDestroySurface(display, surface)
                    EGL14.eglDestroyContext(display, ctx)
                }
                EGL14.eglTerminate(display)
            }
        } catch (_: Throwable) {}
        val pm = context.packageManager
        val libDirs = listOf("/vendor/lib64", "/system/vendor/lib64", "/system/lib64", "/odm/lib64")
        fun hasLib(name: String) = libDirs.any { File(it, name).exists() }
        result.putString("renderer", renderer)
        result.putString("vendor", vendor)
        result.putBoolean("adreno", renderer.contains("Adreno", true))
        result.putBoolean("mali", renderer.contains("Mali", true))
        result.putBoolean("vulkan", pm.hasSystemFeature(PackageManager.FEATURE_VULKAN_HARDWARE_VERSION))
        result.putBoolean("openclLibrary", hasLib("libOpenCL.so"))
        result.putBoolean("hexagon", hasLib("libcdsprpc.so"))
        return result
    }

    private fun powerInfo(): WritableMap {
        val result = Arguments.createMap()
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        result.putInt("thermalStatus", if (Build.VERSION.SDK_INT >= 29) power.currentThermalStatus else -1)
        val headroom = if (Build.VERSION.SDK_INT >= 30) try { power.getThermalHeadroom(10) } catch (_: Exception) { Float.NaN } else Float.NaN
        result.putDouble("thermalHeadroom", if (headroom.isNaN()) -1.0 else headroom.toDouble())
        result.putBoolean("powerSave", power.isPowerSaveMode)
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val temp = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1) ?: -1
        result.putDouble("batteryPercent", if (level >= 0 && scale > 0) level * 100.0 / scale else -1.0)
        result.putBoolean("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL)
        result.putDouble("batteryTempC", if (temp > 0) temp / 10.0 else -1.0)
        return result
    }

    private fun memoryMap(): WritableMap {
        val info = memoryInfo()
        val proc = meminfo()
        val status = processStatus()
        val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val result = Arguments.createMap()
        result.putDouble("totalMb", info.totalMem / MB)
        result.putDouble("availableMb", info.availMem / MB)
        result.putDouble("thresholdMb", info.threshold / MB)
        result.putBoolean("lowMemory", info.lowMemory)
        result.putDouble("memAvailableKernelMb", (proc["MemAvailable"] ?: 0L) / 1024.0)
        result.putDouble("swapTotalMb", (proc["SwapTotal"] ?: 0L) / 1024.0)
        result.putDouble("swapFreeMb", (proc["SwapFree"] ?: 0L) / 1024.0)
        result.putInt("memoryClassMb", activity.memoryClass)
        result.putInt("largeMemoryClassMb", activity.largeMemoryClass)
        result.putDouble("processRssMb", (status["VmRSS"] ?: 0L) / 1024.0)
        result.putDouble("processPeakRssMb", (status["VmHWM"] ?: 0L) / 1024.0)
        return result
    }

    @ReactMethod
    fun probe(promise: Promise) {
        thread(name = "pb-hw-probe") {
            try {
                val result = Arguments.createMap()
                result.putString("manufacturer", Build.MANUFACTURER ?: "")
                result.putString("model", Build.MODEL ?: "")
                result.putString("hardware", Build.HARDWARE ?: "")
                result.putString("board", Build.BOARD ?: "")
                result.putString("soc", if (Build.VERSION.SDK_INT >= 31) (Build.SOC_MANUFACTURER + " " + Build.SOC_MODEL).trim() else Build.HARDWARE ?: "")
                result.putInt("sdk", Build.VERSION.SDK_INT)
                val abis = Arguments.createArray(); Build.SUPPORTED_ABIS.forEach { abis.pushString(it) }
                result.putArray("abis", abis)
                result.putBoolean("arm64", Build.SUPPORTED_64_BIT_ABIS.contains("arm64-v8a"))
                result.putMap("cpu", cpuInfo())
                result.putMap("memory", memoryMap())
                result.putMap("storage", storageInfo())
                result.putMap("gpu", gpuInfo())
                result.putMap("power", powerInfo())
                promise.resolve(result)
            } catch (error: Throwable) {
                promise.reject("HARDWARE_PROBE_FAILED", error.message, error)
            }
        }
    }

    @ReactMethod
    fun getRuntimeState(promise: Promise) {
        try {
            val result = Arguments.createMap()
            result.putMap("memory", memoryMap())
            result.putMap("power", powerInfo())
            promise.resolve(result)
        } catch (error: Throwable) {
            promise.reject("RUNTIME_STATE_FAILED", error.message, error)
        }
    }

    /** Reads a model file the way inference does: sequential and random 512 KiB blocks at 1/2/4 lanes. */
    @ReactMethod
    fun benchmarkStorage(path: String, promise: Promise) {
        thread(name = "pb-io-bench") {
            try {
                val file = File(path.removePrefix("file://"))
                if (!file.exists() || file.length() < 64L * 1024 * 1024) throw IllegalArgumentException("Pick a downloaded model of at least 64 MB to measure storage.")
                val block = 512 * 1024
                val length = file.length()
                val result = Arguments.createMap()
                val seqBytes = minOf(length, 96L * 1024 * 1024)
                val seqStart = Random.nextLong(0, maxOf(1, length - seqBytes)) and (block.toLong() - 1).inv()
                RandomAccessFile(file, "r").use { raf ->
                    val buffer = ByteArray(block)
                    raf.seek(seqStart)
                    val t0 = System.nanoTime(); var read = 0L
                    while (read < seqBytes) { val n = raf.read(buffer); if (n <= 0) break; read += n }
                    result.putDouble("sequentialMBps", read / MB / ((System.nanoTime() - t0) / 1e9))
                }
                val lanes = Arguments.createArray()
                var best = 0.0; var bestLanes = 1
                for (laneCount in intArrayOf(1, 2, 4)) {
                    val perLane = 48
                    val pool = Executors.newFixedThreadPool(laneCount)
                    val t0 = System.nanoTime()
                    val futures = (0 until laneCount).map {
                        pool.submit<Long> {
                            var total = 0L
                            RandomAccessFile(file, "r").use { raf ->
                                val buffer = ByteArray(block)
                                repeat(perLane) {
                                    raf.seek((Random.nextLong(0, length - block)) and (4095L).inv())
                                    total += maxOf(0, raf.read(buffer))
                                }
                            }
                            total
                        }
                    }
                    val bytes = futures.sumOf { it.get(60, TimeUnit.SECONDS) }
                    pool.shutdown()
                    val mbps = bytes / MB / ((System.nanoTime() - t0) / 1e9)
                    val lane = Arguments.createMap(); lane.putInt("lanes", laneCount); lane.putDouble("randomMBps", mbps); lanes.pushMap(lane)
                    if (mbps > best * 1.08) { best = mbps; bestLanes = laneCount }
                }
                result.putArray("random", lanes)
                result.putInt("bestLanes", bestLanes)
                result.putDouble("bestRandomMBps", best)
                result.putString("note", "Reads may be served partly from the page cache; random reads at 512 KiB match MoE expert slices.")
                promise.resolve(result)
            } catch (error: Throwable) {
                promise.reject("STORAGE_BENCH_FAILED", error.message, error)
            }
        }
    }

    @ReactMethod
    fun readGgufInfo(path: String, promise: Promise) {
        thread(name = "pb-gguf") {
            try {
                promise.resolve(GgufInspector.inspect(File(path.removePrefix("file://"))).toMap())
            } catch (error: Throwable) {
                promise.reject("GGUF_READ_FAILED", error.message, error)
            }
        }
    }

    @ReactMethod
    fun getProcessPriority(promise: Promise) {
        promise.resolve(Process.getThreadPriority(Process.myTid()))
    }

    companion object { const val MB = 1048576.0 }
}

/** Minimal GGUF v2/v3 header reader: metadata scalars and tensor table, without loading weights. */
object GgufInspector {
    data class Info(
        val architecture: String,
        val name: String,
        val fileType: Long,
        val expertCount: Long,
        val expertUsedCount: Long,
        val blockCount: Long,
        val contextLength: Long,
        val embeddingLength: Long,
        val headCount: Long,
        val headCountKv: Long,
        val keyLength: Long,
        val valueLength: Long,
        val fullAttentionInterval: Long,
        val leadingDenseBlocks: Long,
        val tensorCount: Long,
        val expertBytes: Long,
        val denseBytes: Long,
        val expertTensorCount: Int,
        val fileBytes: Long,
    ) {
        val isMoe get() = expertCount > 1 && expertBytes > 0
        fun toMap(): WritableMap {
            val m = Arguments.createMap()
            m.putString("architecture", architecture)
            m.putString("name", name)
            m.putDouble("fileType", fileType.toDouble())
            m.putDouble("expertCount", expertCount.toDouble())
            m.putDouble("expertUsedCount", expertUsedCount.toDouble())
            m.putDouble("blockCount", blockCount.toDouble())
            m.putDouble("contextLength", contextLength.toDouble())
            m.putDouble("embeddingLength", embeddingLength.toDouble())
            m.putDouble("headCount", headCount.toDouble())
            m.putDouble("headCountKv", headCountKv.toDouble())
            m.putDouble("keyLength", keyLength.toDouble())
            m.putDouble("valueLength", valueLength.toDouble())
            m.putDouble("fullAttentionInterval", fullAttentionInterval.toDouble())
            m.putDouble("leadingDenseBlocks", leadingDenseBlocks.toDouble())
            m.putDouble("tensorCount", tensorCount.toDouble())
            m.putDouble("expertBytes", expertBytes.toDouble())
            m.putDouble("denseBytes", denseBytes.toDouble())
            m.putInt("expertTensorCount", expertTensorCount)
            m.putDouble("fileBytes", fileBytes.toDouble())
            m.putBoolean("isMoe", isMoe)
            m.putBoolean("streamable", isMoe)
            return m
        }
    }

    private class Reader(input: InputStream) {
        private val stream = BufferedInputStream(input, 1 shl 16)
        var position = 0L
        private val scratch = ByteArray(8)
        fun bytes(n: Int): ByteArray {
            val out = ByteArray(n); var off = 0
            while (off < n) { val r = stream.read(out, off, n - off); if (r < 0) throw IllegalStateException("Truncated GGUF header"); off += r }
            position += n; return out
        }
        fun skip(n: Long) {
            var left = n
            while (left > 0) { val s = stream.skip(left); if (s <= 0) { if (stream.read() < 0) throw IllegalStateException("Truncated GGUF header"); left -= 1 } else left -= s }
            position += n
        }
        private fun le(n: Int): Long {
            var off = 0
            while (off < n) { val r = stream.read(scratch, off, n - off); if (r < 0) throw IllegalStateException("Truncated GGUF header"); off += r }
            position += n
            var v = 0L; for (i in n - 1 downTo 0) v = (v shl 8) or (scratch[i].toLong() and 0xff); return v
        }
        fun u8() = le(1); fun u16() = le(2); fun u32() = le(4); fun u64() = le(8)
        fun string(): String { val n = u64(); if (n > 1 shl 24) throw IllegalStateException("Corrupt GGUF string"); return String(bytes(n.toInt()), Charsets.UTF_8) }
    }

    private val sizes = mapOf(0 to 1, 1 to 1, 2 to 2, 3 to 2, 4 to 4, 5 to 4, 6 to 4, 7 to 1, 10 to 8, 11 to 8, 12 to 8)

    private fun value(r: Reader, type: Int): Any? = when (type) {
        0 -> r.u8(); 1 -> r.u8().toByte().toLong(); 2 -> r.u16(); 3 -> r.u16().toShort().toLong()
        4 -> r.u32(); 5 -> r.u32().toInt().toLong(); 6 -> java.lang.Float.intBitsToFloat(r.u32().toInt()).toDouble()
        7 -> r.u8() != 0L; 8 -> r.string(); 10 -> r.u64(); 11 -> r.u64(); 12 -> java.lang.Double.longBitsToDouble(r.u64())
        9 -> {
            val itemType = r.u32().toInt(); val count = r.u64()
            val size = sizes[itemType]
            if (size != null) r.skip(size * count) else repeat(count.toInt()) { value(r, itemType) }
            null
        }
        else -> throw IllegalStateException("Unknown GGUF value type $type")
    }

    private val expertTensor = Regex("^blk\\.\\d+\\..*_exps(\\.weight)?$")

    fun inspect(file: File): Info {
        if (!file.exists()) throw IllegalArgumentException("Model file not found")
        FileInputStream(file).use { input ->
            val r = Reader(input)
            if (String(r.bytes(4), Charsets.US_ASCII) != "GGUF") throw IllegalArgumentException("Not a GGUF model file")
            val version = r.u32()
            if (version < 2) throw IllegalArgumentException("GGUF v1 is not supported")
            val tensorCount = r.u64(); val kvCount = r.u64()
            val kv = HashMap<String, Any>()
            for (i in 0 until kvCount) {
                val key = r.string(); val type = r.u32().toInt()
                value(r, type)?.let { kv[key] = it }
            }
            val arch = kv["general.architecture"] as? String ?: ""
            fun num(key: String): Long = when (val v = kv["$arch.$key"]) { is Long -> v; is Double -> v.toLong(); is Boolean -> if (v) 1 else 0; else -> 0L }
            val expertCount = num("expert_count")
            val alignment = (kv["general.alignment"] as? Long)?.takeIf { it > 0 } ?: 32L
            data class T(val name: String, val dims: LongArray, val offset: Long)
            val tensors = ArrayList<T>(tensorCount.toInt())
            for (i in 0 until tensorCount) {
                val name = r.string(); val nd = r.u32().toInt()
                val dims = LongArray(nd) { r.u64() }
                r.u32(); val offset = r.u64()
                tensors.add(T(name, dims, offset))
            }
            val dataStart = (r.position + alignment - 1) / alignment * alignment
            val fileBytes = file.length()
            tensors.sortBy { it.offset }
            var expertBytes = 0L; var denseBytes = 0L; var expertTensors = 0
            for ((i, t) in tensors.withIndex()) {
                val end = if (i + 1 < tensors.size) tensors[i + 1].offset else fileBytes - dataStart
                val size = (end - t.offset).coerceAtLeast(0)
                if (expertCount > 1 && t.dims.size == 3 && t.dims[2] == expertCount && expertTensor.matches(t.name)) { expertBytes += size; expertTensors += 1 }
                else denseBytes += size
            }
            return Info(
                architecture = arch, name = kv["general.name"] as? String ?: "", fileType = (kv["general.file_type"] as? Long) ?: -1,
                expertCount = expertCount, expertUsedCount = num("expert_used_count"), blockCount = num("block_count"),
                contextLength = num("context_length"), embeddingLength = num("embedding_length"),
                headCount = num("attention.head_count"), headCountKv = num("attention.head_count_kv"),
                keyLength = num("attention.key_length"), valueLength = num("attention.value_length"),
                fullAttentionInterval = num("full_attention_interval"), leadingDenseBlocks = num("leading_dense_block_count"),
                tensorCount = tensorCount, expertBytes = expertBytes, denseBytes = denseBytes, expertTensorCount = expertTensors, fileBytes = fileBytes,
            )
        }
    }
}
