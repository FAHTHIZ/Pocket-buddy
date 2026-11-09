package com.pocketbuddy

import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.TextView
import android.widget.VideoView
import java.io.File

/** Minimal full-screen player for generated videos, so playback stays inside Pocket Buddy. */
class VideoPlayerActivity : Activity() {
    companion object {
        const val EXTRA_PATH = "path"
        const val EXTRA_TITLE = "title"
    }

    private var video: VideoView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val path = intent.getStringExtra(EXTRA_PATH) ?: ""
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        val file = File(path)
        val mediaRoot = File(filesDir, "media").canonicalPath + File.separator
        if (path.isBlank() || !file.canonicalPath.startsWith(mediaRoot) || !file.isFile) {
            val message = TextView(this)
            message.text = "This video is no longer available."
            message.setTextColor(Color.WHITE)
            message.gravity = Gravity.CENTER
            root.addView(message, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            setContentView(root)
            return
        }
        val player = VideoView(this)
        video = player
        root.addView(player, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        val title = TextView(this)
        title.text = intent.getStringExtra(EXTRA_TITLE) ?: ""
        title.setTextColor(Color.parseColor("#DDDDDD"))
        title.textSize = 13f
        title.maxLines = 2
        title.setPadding(36, 48, 36, 12)
        root.addView(title, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        setContentView(root)
        val controller = MediaController(this)
        controller.setAnchorView(player)
        player.setMediaController(controller)
        player.setVideoURI(Uri.fromFile(file))
        player.setOnPreparedListener { mp ->
            mp.isLooping = true
            player.start()
            controller.show(2500)
        }
        player.setOnErrorListener { _, _, _ ->
            title.text = "This video format could not be played on this phone. Use Open with to try another app."
            true
        }
        root.setOnClickListener { controller.show(2500) }
    }

    override fun onPause() {
        super.onPause()
        video?.pause()
    }

    override fun onDestroy() {
        video?.stopPlayback()
        video = null
        super.onDestroy()
    }
}
