package com.pocketbuddy

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.io.RandomAccessFile

/**
 * Converts the MJPEG AVI written by stable-diffusion.cpp into an H.264 MP4 that every Android
 * player, gallery and messaging app understands. Frames are decoded with BitmapFactory and fed to
 * the hardware encoder through flexible YUV images, so presentation timestamps are exact.
 */
object MjpegAviToMp4 {
    /** Returns the JPEG payload of every "00dc" video chunk in the AVI file. */
    fun readFrames(avi: File): List<ByteArray> {
        val frames = mutableListOf<ByteArray>()
        RandomAccessFile(avi, "r").use { raf ->
            val bytes = ByteArray(raf.length().toInt())
            raf.readFully(bytes)
            var i = 12
            while (i + 8 <= bytes.size) {
                val id = String(bytes, i, 4, Charsets.US_ASCII)
                val size = (bytes[i + 4].toInt() and 0xff) or ((bytes[i + 5].toInt() and 0xff) shl 8) or
                    ((bytes[i + 6].toInt() and 0xff) shl 16) or ((bytes[i + 7].toInt() and 0xff) shl 24)
                if (size < 0 || i + 8 + size > bytes.size) break
                when (id) {
                    "RIFF", "LIST" -> { i += 12; continue } // descend into lists (skip list type)
                    "00dc" -> if (size > 4) frames += bytes.copyOfRange(i + 8, i + 8 + size)
                }
                i += 8 + size + (size and 1)
            }
        }
        return frames
    }

    private fun argbToYuv(bitmap: Bitmap, image: android.media.Image) {
        val w = image.width; val h = image.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
        val y = image.planes[0]; val u = image.planes[1]; val v = image.planes[2]
        val yb = y.buffer; val ub = u.buffer; val vb = v.buffer
        for (row in 0 until h) {
            for (col in 0 until w) {
                val c = pixels[row * w + col]
                val r = (c shr 16) and 0xff; val g = (c shr 8) and 0xff; val b = c and 0xff
                val yy = ((66 * r + 129 * g + 25 * b + 128) shr 8) + 16
                yb.put(row * y.rowStride + col * y.pixelStride, yy.coerceIn(0, 255).toByte())
                if (row % 2 == 0 && col % 2 == 0) {
                    val uu = ((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128
                    val vv = ((112 * r - 94 * g - 18 * b + 128) shr 8) + 128
                    ub.put((row / 2) * u.rowStride + (col / 2) * u.pixelStride, uu.coerceIn(0, 255).toByte())
                    vb.put((row / 2) * v.rowStride + (col / 2) * v.pixelStride, vv.coerceIn(0, 255).toByte())
                }
            }
        }
    }

    /** Encodes [frames] to [out] at [fps]; writes the first frame to [thumbnail]. Returns frame count. */
    fun convert(avi: File, out: File, fps: Int, thumbnail: File?): Int {
        val frames = readFrames(avi)
        if (frames.isEmpty()) throw IllegalStateException("The generated video contained no frames.")
        val first = BitmapFactory.decodeByteArray(frames[0], 0, frames[0].size) ?: throw IllegalStateException("The generated video frames could not be decoded.")
        val width = first.width / 2 * 2; val height = first.height / 2 * 2
        thumbnail?.let { file -> file.outputStream().use { first.compress(Bitmap.CompressFormat.JPEG, 85, it) } }
        first.recycle()

        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            setInteger(MediaFormat.KEY_BIT_RATE, (width * height * fps * 0.25).toInt().coerceAtLeast(1_000_000))
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var track = -1; var muxing = false
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            val info = MediaCodec.BufferInfo()
            var next = 0; var inputDone = false; var outputDone = false
            val frameUs = 1_000_000L / fps
            while (!outputDone) {
                if (!inputDone) {
                    val index = codec.dequeueInputBuffer(10_000)
                    if (index >= 0) {
                        if (next >= frames.size) {
                            codec.queueInputBuffer(index, 0, 0, next * frameUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            val decoded = BitmapFactory.decodeByteArray(frames[next], 0, frames[next].size)
                            val bitmap = if (decoded != null && (decoded.width != width || decoded.height != height)) Bitmap.createScaledBitmap(decoded, width, height, true).also { decoded.recycle() } else decoded
                            val image = codec.getInputImage(index)
                            if (bitmap != null && image != null) argbToYuv(bitmap, image)
                            bitmap?.recycle()
                            codec.queueInputBuffer(index, 0, width * height * 3 / 2, next * frameUs, 0)
                            next++
                        }
                    }
                }
                val outIndex = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> { track = muxer.addTrack(codec.outputFormat); muxer.start(); muxing = true }
                    outIndex >= 0 -> {
                        val buffer = codec.getOutputBuffer(outIndex)
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                        if (info.size > 0 && muxing && buffer != null) {
                            buffer.position(info.offset); buffer.limit(info.offset + info.size)
                            muxer.writeSampleData(track, buffer, info)
                        }
                        codec.releaseOutputBuffer(outIndex, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                    }
                }
            }
        } finally {
            try { codec.stop() } catch (_: Exception) {}
            codec.release()
            try { if (muxing) muxer.stop() } catch (_: Exception) {}
            muxer.release()
        }
        return frames.size
    }
}
