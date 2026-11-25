package com.englishrecord.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodService
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

class VoiceImeService : InputMethodService() {
    companion object {
        private const val SAMPLE_RATE = 16_000
        private const val MAX_SECONDS = 60
        private const val MODEL_ASSET = "resources/models/ggml-base.en-q5_1.bin"
        private const val MODEL_MIN_BYTES = 20L * 1024L * 1024L

        @Volatile
        private var libraryLoaded = false

        init {
            libraryLoaded = try {
                System.loadLibrary("english_record_lib")
                true
            } catch (_: Throwable) {
                false
            }
        }
    }

    private external fun nativeTranscribe(samples: FloatArray, modelPath: String): String

    private val mainHandler = Handler(Looper.getMainLooper())
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private val chunks = ArrayList<ShortArray>()

    private var statusView: TextView? = null
    private var micButton: TextView? = null
    private var audioRecord: AudioRecord? = null
    private var recordingThread: Thread? = null
    private var captureRate = SAMPLE_RATE
    private var startedAt = 0L
    private var totalSamples = 0
    private var modelPath: String? = null
    private var inputSession = 0

    @Volatile
    private var recording = false

    @Volatile
    private var transcribing = false

    private val ticker = object : Runnable {
        override fun run() {
            if (!recording) return
            val seconds = ((System.currentTimeMillis() - startedAt) / 1000L).toInt()
            setStatus("Escuchando… ${seconds} s · toca Detener al terminar")
            mainHandler.postDelayed(this, 1000L)
        }
    }

    override fun onCreateInputView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(14))
            setBackgroundColor(Color.parseColor("#17151C"))
        }

        val brand = TextView(this).apply {
            text = "ENGLISH RECORD · TECLADO DE VOZ"
            textSize = 10f
            letterSpacing = 0.12f
            setTextColor(Color.parseColor("#F25441"))
            gravity = Gravity.CENTER
        }
        root.addView(brand, lp(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val status = TextView(this).apply {
            textSize = 12f
            setTextColor(Color.parseColor("#B9AFB4"))
            gravity = Gravity.CENTER
            maxLines = 2
        }
        root.addView(
            status,
            lp(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(4)
            },
        )

        val mic = TextView(this).apply {
            textSize = 17f
            letterSpacing = 0.02f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = rounded("#F25441", 20)
            isClickable = true
            isFocusable = true
            setOnClickListener { onMicPressed() }
        }
        root.addView(
            mic,
            lp(LinearLayout.LayoutParams.MATCH_PARENT, dp(62)).apply {
                topMargin = dp(10)
            },
        )

        val hint = TextView(this).apply {
            text = "Máx. 60 s por dictado · el audio se procesa en tu dispositivo"
            textSize = 10f
            setTextColor(Color.parseColor("#675F69"))
            gravity = Gravity.CENTER
        }
        root.addView(
            hint,
            lp(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(6)
            },
        )

        val keys = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        keys.addView(
            makeKey("Espacio") { commitSpace() },
            lp(0, dp(46), 1.8f).apply { rightMargin = dp(6) },
        )
        keys.addView(
            makeKey("Borrar") { backspace() },
            lp(0, dp(46), 1f).apply { rightMargin = dp(6) },
        )
        keys.addView(
            makeKey("Intro") { sendEnter() },
            lp(0, dp(46), 1f).apply { rightMargin = dp(6) },
        )
        keys.addView(
            makeKey("Ocultar") { requestHideSelf(0) },
            lp(0, dp(46), 1.2f),
        )
        root.addView(
            keys,
            lp(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(10)
            },
        )

        statusView = status
        micButton = mic
        updateMicButton()
        refreshStatus()
        return root
    }

    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        inputSession += 1
        updateMicButton()
        refreshStatus()
    }

    override fun onFinishInput() {
        inputSession += 1
        abortRecording()
        super.onFinishInput()
    }

    override fun onEvaluateFullscreenMode(): Boolean = false

    override fun onDestroy() {
        abortRecording()
        worker.shutdownNow()
        mainHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun onMicPressed() {
        when {
            !libraryLoaded -> setStatus("El motor de voz no está disponible en esta compilación.")
            transcribing -> Unit
            recording -> stopRecording()
            !hasMicPermission() -> openAppForPermission()
            else -> startRecording()
        }
    }

    private fun hasMicPermission(): Boolean =
        checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun refreshStatus() {
        setStatus(
            when {
                !libraryLoaded -> "El motor de voz no está disponible en esta compilación."
                !hasMicPermission() -> "Falta el permiso de micrófono. Toca «Activar micrófono» para concederlo."
                !recording && !transcribing -> "Toca «Hablar» y dicta. El texto aparecerá en la app activa."
                else -> statusView?.text?.toString().orEmpty()
            },
        )
    }

    private fun updateMicButton() {
        val mic = micButton ?: return
        mic.isEnabled = libraryLoaded && !transcribing
        mic.alpha = if (mic.isEnabled) 1f else 0.65f
        when {
            !libraryLoaded -> {
                mic.text = "No disponible"
                mic.background = rounded("#3A3540", 20)
            }
            transcribing -> {
                mic.text = "Transcribiendo…"
                mic.background = rounded("#3A3540", 20)
            }
            recording -> {
                mic.text = "Detener y transcribir"
                mic.background = rounded("#D9483B", 20)
            }
            hasMicPermission() -> {
                mic.text = "Hablar"
                mic.background = rounded("#F25441", 20)
            }
            else -> {
                mic.text = "Activar micrófono"
                mic.background = rounded("#F25441", 20)
            }
        }
    }

    private fun openAppForPermission() {
        setStatus("Abre English Record y concede el micrófono; luego vuelve a esta app.")
        try {
            val intent = Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_REQUEST_MIC, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            startActivity(intent)
        } catch (error: Throwable) {
            setStatus("No se pudo abrir English Record: ${error.message ?: "error desconocido"}")
        }
    }

    private fun startRecording() {
        if (recording) return
        val recorder = createRecorder() ?: run {
            setStatus("No se pudo abrir el micrófono en este dispositivo.")
            return
        }

        chunks.clear()
        totalSamples = 0
        audioRecord = recorder
        recording = true
        startedAt = System.currentTimeMillis()

        try {
            recorder.startRecording()
        } catch (error: Throwable) {
            recording = false
            audioRecord = null
            try {
                recorder.release()
            } catch (_: Throwable) {
            }
            updateMicButton()
            setStatus("No se pudo iniciar la grabación: ${error.message ?: "error desconocido"}")
            return
        }

        updateMicButton()
        setStatus("Escuchando… 0 s · toca Detener al terminar")
        mainHandler.postDelayed(ticker, 1000L)

        val buffer = ShortArray(max(2048, captureRate / 10))
        recordingThread = Thread({
            try {
                while (recording) {
                    val read = recorder.read(buffer, 0, buffer.size)
                    if (read > 0) {
                        chunks.add(buffer.copyOf(read))
                        totalSamples += read
                        if (totalSamples >= captureRate * MAX_SECONDS) {
                            mainHandler.post { if (recording) stopRecording() }
                            break
                        }
                    } else if (read < 0) {
                        mainHandler.post { if (recording) failRecording("El micrófono dejó de responder.") }
                        break
                    }
                }
            } catch (error: Throwable) {
                mainHandler.post {
                    if (recording) failRecording("Error al grabar: ${error.message ?: "desconocido"}")
                }
            }
        }, "voice-ime-record").also { it.start() }
    }

    private fun stopRecording() {
        if (!recording) return
        recording = false
        mainHandler.removeCallbacks(ticker)

        val recorder = audioRecord
        val thread = recordingThread
        try {
            recorder?.stop()
        } catch (_: Throwable) {
        }
        if (thread != null && thread !== Thread.currentThread()) {
            try {
                thread.join(1200L)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
        try {
            recorder?.release()
        } catch (_: Throwable) {
        }
        audioRecord = null
        recordingThread = null

        val rate = captureRate
        val length = chunks.sumOf { it.size }
        if (length < rate / 3) {
            chunks.clear()
            totalSamples = 0
            updateMicButton()
            setStatus("Grabación demasiado corta. Toca «Hablar» y prueba de nuevo.")
            return
        }

        val samples = FloatArray(length)
        var offset = 0
        for (chunk in chunks) {
            for (value in chunk) {
                samples[offset++] = value / 32768f
            }
        }
        chunks.clear()
        totalSamples = 0

        transcribe(resample(samples, rate))
    }

    private fun failRecording(message: String) {
        recording = false
        mainHandler.removeCallbacks(ticker)
        try {
            audioRecord?.stop()
        } catch (_: Throwable) {
        }
        try {
            audioRecord?.release()
        } catch (_: Throwable) {
        }
        audioRecord = null
        recordingThread = null
        chunks.clear()
        totalSamples = 0
        updateMicButton()
        setStatus(message)
    }

    private fun abortRecording() {
        if (!recording) return
        recording = false
        mainHandler.removeCallbacks(ticker)
        val recorder = audioRecord
        try {
            recorder?.stop()
        } catch (_: Throwable) {
        }
        try {
            recordingThread?.join(800L)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        try {
            recorder?.release()
        } catch (_: Throwable) {
        }
        audioRecord = null
        recordingThread = null
        chunks.clear()
        totalSamples = 0
        updateMicButton()
        setStatus("Grabación cancelada.")
    }

    private fun transcribe(samples: FloatArray) {
        transcribing = true
        val session = inputSession
        updateMicButton()
        setStatus("Transcribiendo en el dispositivo…")

        worker.execute {
            var failure: String? = null
            val text = try {
                val model = ensureModelFile()
                setStatus("Transcribiendo en el dispositivo…")
                nativeTranscribe(samples, model).trim()
            } catch (error: Throwable) {
                failure = error.message ?: "No se pudo transcribir el audio."
                ""
            }

            mainHandler.post {
                transcribing = false
                updateMicButton()
                if (session != inputSession) {
                    setStatus("Dictado descartado porque cambió el campo de texto.")
                    return@post
                }
                if (failure != null) {
                    setStatus(failure ?: "No se pudo transcribir el audio.")
                    return@post
                }
                if (text.isEmpty()) {
                    setStatus("No se detectó voz. Prueba a hablar más cerca del micrófono.")
                    return@post
                }
                val connection = currentInputConnection
                if (connection == null) {
                    setStatus("No hay un campo de texto activo para escribir el dictado.")
                    return@post
                }
                val insertion = if (text.endsWith(" ")) text else "$text "
                connection.commitText(insertion, 1)
                setStatus("Listo. El texto se ha escrito en la app activa.")
            }
        }
    }

    private fun ensureModelFile(): String {
        val cached = modelPath
        if (cached != null) {
            val file = File(cached)
            if (file.exists() && file.length() >= MODEL_MIN_BYTES) return cached
        }

        val target = File(filesDir, "whisper/ggml-base.en-q5_1.bin")
        if (!target.exists() || target.length() < MODEL_MIN_BYTES) {
            setStatus("Preparando el modelo de voz (solo la primera vez)…")
            val parent = target.parentFile
            parent?.mkdirs()
            val partial = File(parent, "ggml-base.en-q5_1.bin.part")
            try {
                assets.open(MODEL_ASSET).use { input ->
                    FileOutputStream(partial).use { output ->
                        input.copyTo(output, 64 * 1024)
                        output.fd.sync()
                    }
                }
                if (!partial.renameTo(target)) {
                    partial.copyTo(target, overwrite = true)
                    partial.delete()
                }
            } catch (error: Throwable) {
                partial.delete()
                throw IllegalStateException(
                    "No se pudo preparar el modelo de voz: ${error.message ?: "error de almacenamiento"}",
                    error,
                )
            }
        }

        val path = target.absolutePath
        modelPath = path
        return path
    }

    private fun createRecorder(): AudioRecord? {
        val sources = intArrayOf(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            MediaRecorder.AudioSource.MIC,
        )
        val rates = intArrayOf(SAMPLE_RATE, 44_100, 48_000)
        for (source in sources) {
            for (rate in rates) {
                val minBuffer = AudioRecord.getMinBufferSize(
                    rate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                )
                if (minBuffer <= 0) continue
                var recorder: AudioRecord? = null
                try {
                    recorder = AudioRecord(
                        source,
                        rate,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        max(minBuffer, rate),
                    )
                    if (recorder.state == AudioRecord.STATE_INITIALIZED) {
                        captureRate = rate
                        return recorder
                    }
                } catch (_: Throwable) {
                }
                try {
                    recorder?.release()
                } catch (_: Throwable) {
                }
            }
        }
        return null
    }

    private fun resample(input: FloatArray, from: Int): FloatArray {
        if (from == SAMPLE_RATE || input.size < 2) return input
        val outputSize = (input.size.toLong() * SAMPLE_RATE / from).toInt()
        if (outputSize < 2) return FloatArray(0)
        val output = FloatArray(outputSize)
        val step = from.toDouble() / SAMPLE_RATE
        for (index in 0 until outputSize) {
            val position = index * step
            val base = position.toInt()
            val next = min(base + 1, input.size - 1)
            val fraction = (position - base).toFloat()
            output[index] = input[base] * (1f - fraction) + input[next] * fraction
        }
        return output
    }

    private fun makeKey(label: String, onClick: () -> Unit): TextView =
        TextView(this).apply {
            text = label
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#F7F2ED"))
            background = rounded("#211E28", 14)
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }
        }

    private fun commitSpace() {
        currentInputConnection?.commitText(" ", 1)
    }

    private fun backspace() {
        val connection = currentInputConnection ?: return
        val selected = connection.getSelectedText(0)
        if (!selected.isNullOrEmpty()) {
            connection.commitText("", 1)
            return
        }
        if (!connection.deleteSurroundingTextInCodePoints(1, 0)) {
            connection.deleteSurroundingText(1, 0)
        }
    }

    private fun sendEnter() {
        if (sendDefaultEditorAction(true)) return
        val connection = currentInputConnection ?: return
        connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
        connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
    }

    private fun setStatus(message: String) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            statusView?.text = message
        } else {
            mainHandler.post { statusView?.text = message }
        }
    }

    private fun rounded(color: String, radiusDp: Int): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(Color.parseColor(color))
            cornerRadius = dp(radiusDp).toFloat()
        }

    private fun lp(width: Int, height: Int, weight: Float = 0f): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(width, height, weight)

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
