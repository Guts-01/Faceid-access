package br.local.faceidaccess

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.SystemClock
import android.text.InputType
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import com.chaquo.python.Python
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URL
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.HttpsURLConnection

/** Visual access-control demo. Blink is a weak presentation check, not certified PAD. */
class MainActivity : ComponentActivity() {
    private enum class Screen { CONTROL, CAMERA, CONNECTION, ENROLLMENT }
    private val background = Color.rgb(9, 9, 10)
    private val surface = Color.rgb(26, 26, 28)
    private val textPrimary = Color.rgb(245, 245, 247)
    private val textMuted = Color.rgb(164, 164, 174)
    private val prefs by lazy { getSharedPreferences("faceidaccess", MODE_PRIVATE) }
    private val worker = Executors.newSingleThreadExecutor()
    private val detector by lazy { FaceDetection.getClient(
        FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .setMinFaceSize(0.2f).build()
    ) }
    private lateinit var preview: PreviewView
    private lateinit var controlPreview: FrameLayout
    private lateinit var cameraPreview: FrameLayout
    private lateinit var enrollmentPreview: FrameLayout
    private lateinit var controlPage: View
    private lateinit var connectionPage: View
    private lateinit var enrollmentPage: View
    private lateinit var cameraPage: View
    private lateinit var pairedLabel: TextView
    private val statuses = mutableListOf<TextView>()
    private lateinit var serverInput: EditText
    private lateinit var pairTokenInput: EditText
    private lateinit var enrollmentTokenInput: EditText
    private lateinit var imageCapture: ImageCapture
    private var cameraProvider: ProcessCameraProvider? = null
    private var cameraReady = false
    private var cameraSequence = 0
    private var currentScreen = Screen.CONTROL
    @Volatile private var scanning = false
    @Volatile private var syncing = false
    private var busy = false
    private var blinkStep = 0
    private var lastAnalyze = 0L
    private var lastFace = 0L
    private var readyAfterAbsence = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = background
        window.navigationBarColor = background
        buildUi()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 10)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun shape(color: Int, radius: Int = 18) = GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }
    private fun text(value: String, size: Float, color: Int = textPrimary) = TextView(this).apply {
        this.text = value; textSize = size; setTextColor(color)
    }
    private fun action(value: String, dark: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        text = value; isAllCaps = false; textSize = 15f
        setTextColor(if (dark) textPrimary else this@MainActivity.background)
        background = shape(if (dark) surface else textPrimary, 12)
        setOnClickListener { onClick() }
    }
    private fun field(hintText: String) = EditText(this).apply {
        hint = hintText; setHintTextColor(Color.rgb(130, 130, 138)); setTextColor(textPrimary)
        setSingleLine(true); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        background = shape(surface, 12); setPadding(dp(16), dp(12), dp(16), dp(12))
    }
    private fun row(value: View, top: Int = 12) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }
    private fun page(title: String, subtitle: String): Pair<ScrollView, LinearLayout> {
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(30), dp(20), dp(36)) }
        body.addView(text("Faceid Access  /  PAINEL DO APARELHO", 11f, textMuted))
        body.addView(text(title, 29f).apply { setTypeface(null, android.graphics.Typeface.BOLD) }, row(body, 13))
        body.addView(text(subtitle, 14f, textMuted), row(body, 7))
        val scroll = ScrollView(this).apply { setBackgroundColor(this@MainActivity.background); isFillViewport = true; addView(body) }
        return scroll to body
    }
    private fun nav(body: LinearLayout, selected: Screen) {
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; background = shape(surface, 13); setPadding(dp(4), dp(4), dp(4), dp(4)) }
        listOf(Triple("FaceId acess", Screen.CONTROL, 0), Triple("Conexão", Screen.CONNECTION, 1), Triple("Cadastro", Screen.ENROLLMENT, 2)).forEach { (label, screen, _) ->
            val button = action(label, screen != selected) { setScreen(screen) }
            bar.addView(button, LinearLayout.LayoutParams(0, dp(44), 1f))
        }
        body.addView(bar, row(bar, 24))
    }
    private fun statusView(): TextView = text("Aguardando câmera", 15f, textMuted).apply {
        gravity = Gravity.CENTER; setPadding(dp(18), dp(18), dp(18), dp(18)); background = shape(surface, 14)
        statuses.add(this)
    }
    private fun previewHost(height: Int) = FrameLayout(this).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(height)).apply { topMargin = dp(24) }
        background = shape(surface, 16)
        clipToOutline = true
    }
    private fun buildUi() {
        val root = FrameLayout(this).apply { setBackgroundColor(this@MainActivity.background) }
        setContentView(root)
        preview = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }

        val (control, controlBody) = page("Ponto de entrada", "Use este aparelho como câmera.")
        controlPage = control
        nav(controlBody, Screen.CONTROL)
        controlPreview = previewHost(246)
        controlBody.addView(controlPreview)
        controlBody.addView(statusView(), row(controlBody, 18))
        controlBody.addView(action("Iniciar camera em tela cheia") { startScan() }, row(controlBody, 18))
        controlBody.addView(text("A leitura começa após sincronizar os cadastros com o servidor. Para uma nova tentativa, afaste-se da câmera e volte.", 13f, textMuted), row(controlBody, 16))
        root.addView(controlPage, FrameLayout.LayoutParams(-1, -1))

        val (connection, connectionBody) = page("Conexão", "Configure o endereço do computador e pareie este aparelho.")
        connectionPage = connection
        nav(connectionBody, Screen.CONNECTION)
        connectionBody.addView(text("ENDEREÇO DO SERVIDOR", 11f, textMuted), row(connectionBody, 30))
        serverInput = field("https://IP-DO-COMPUTADOR:3443").apply { setText(prefs.getString("server", "")) }
        connectionBody.addView(serverInput, row(connectionBody, 9))
        connectionBody.addView(action("Salvar conexão", true) { saveConnection() }, row(connectionBody, 12))
        connectionBody.addView(text("CÓDIGO DE PAREAMENTO", 11f, textMuted), row(connectionBody, 31))
        pairTokenInput = field("Cole o código gerado no painel")
        connectionBody.addView(pairTokenInput, row(connectionBody, 9))
        connectionBody.addView(action("Parear aparelho") { pair() }, row(connectionBody, 12))
        pairedLabel = text("Aparelho ainda não pareado", 13f, textMuted)
        connectionBody.addView(pairedLabel, row(connectionBody, 19))
        connectionBody.addView(statusView(), row(connectionBody, 15))
        root.addView(connectionPage, FrameLayout.LayoutParams(-1, -1))

        val (enrollment, enrollmentBody) = page("Cadastro facial", "Use o código emitido no painel para cadastrar uma pessoa.")
        enrollmentPage = enrollment
        nav(enrollmentBody, Screen.ENROLLMENT)
        enrollmentPreview = previewHost(250)
        enrollmentBody.addView(enrollmentPreview)
        enrollmentBody.addView(text("Enquadre um único rosto e mantenha boa iluminação.", 13f, textMuted), row(enrollmentBody, 13))
        enrollmentTokenInput = field("Código de cadastro facial")
        enrollmentBody.addView(enrollmentTokenInput, row(enrollmentBody, 19))
        enrollmentBody.addView(action("Cadastrar rosto") { capture(true) }, row(enrollmentBody, 12))
        enrollmentBody.addView(statusView(), row(enrollmentBody, 17))
        root.addView(enrollmentPage, FrameLayout.LayoutParams(-1, -1))

        val full = FrameLayout(this).apply { setBackgroundColor(this@MainActivity.background) }
        cameraPage = full
        cameraPreview = FrameLayout(this)
        full.addView(cameraPreview, FrameLayout.LayoutParams(-1, -1))
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(20), dp(22), dp(20), dp(12)) }
        top.addView(text("●  CAMERA ATIVA", 13f, Color.rgb(126, 230, 167)).apply { setTypeface(null, android.graphics.Typeface.BOLD) }, LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(action("Reduzir e parar", true) { setScreen(Screen.CONTROL) })
        full.addView(top, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))
        val bottom = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(20), dp(20), dp(28)); background = shape(Color.rgb(20, 20, 22), 20) }
        bottom.addView(statusView())
        bottom.addView(text("Olhe para a câmera e pisque. Apenas uma pessoa por vez.", 13f, textMuted), row(bottom, 15))
        full.addView(bottom, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM).apply { setMargins(dp(12), 0, dp(12), dp(15)) })
        root.addView(cameraPage, FrameLayout.LayoutParams(-1, -1))
        setScreen(Screen.CONTROL)
    }

    private fun show(message: String) { runOnUiThread {
        val color = when {
            message.startsWith("ACESSO AUTORIZADO") -> Color.rgb(126, 230, 167)
            message.startsWith("ACESSO NEGADO") || message.startsWith("SEM CONFIRMAÇÃO") -> Color.rgb(255, 151, 158)
            else -> textPrimary
        }
        statuses.forEach { it.text = message; it.setTextColor(color) }
    } }
    private fun setScreen(screen: Screen) {
        if (screen != Screen.CAMERA) scanning = false
        currentScreen = screen
        controlPage.visibility = if (screen == Screen.CONTROL) View.VISIBLE else View.GONE
        connectionPage.visibility = if (screen == Screen.CONNECTION) View.VISIBLE else View.GONE
        enrollmentPage.visibility = if (screen == Screen.ENROLLMENT) View.VISIBLE else View.GONE
        cameraPage.visibility = if (screen == Screen.CAMERA) View.VISIBLE else View.GONE
        pairedLabel.text = if (prefs.getString("deviceId", null) != null) "Aparelho pareado com o servidor" else "Aparelho ainda não pareado"
        val immersive = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        window.decorView.systemUiVisibility = if (screen == Screen.CAMERA) immersive else 0
        if (screen == Screen.CONNECTION) { stopCamera(); return }
        val host = when (screen) { Screen.CONTROL -> controlPreview; Screen.CAMERA -> cameraPreview; Screen.ENROLLMENT -> enrollmentPreview; else -> controlPreview }
        stopCamera()
        (preview.parent as? ViewGroup)?.removeView(preview)
        host.addView(preview, FrameLayout.LayoutParams(-1, -1))
        startCamera()
    }
    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        if (code == 10 && results.firstOrNull() == PackageManager.PERMISSION_GRANTED) startCamera()
        else show("Permissão de câmera necessária")
    }

    private fun startCamera() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED || currentScreen == Screen.CONNECTION) return
        cameraReady = false
        val sequence = ++cameraSequence
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                if (sequence != cameraSequence || currentScreen == Screen.CONNECTION) return@addListener
                val provider = future.get()
                cameraProvider = provider
                val display = Preview.Builder().build().also { it.setSurfaceProvider(preview.surfaceProvider) }
                imageCapture = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                analysis.setAnalyzer(ContextCompat.getMainExecutor(this)) { frame ->
                    val time = SystemClock.elapsedRealtime()
                    if (!scanning || busy || time - lastAnalyze < 250) { frame.close(); return@setAnalyzer }
                    lastAnalyze = time
                    val media = frame.image
                    if (media == null) { frame.close(); return@setAnalyzer }
                    detector.process(InputImage.fromMediaImage(media, frame.imageInfo.rotationDegrees))
                        .addOnSuccessListener { faces ->
                            if (!scanning) return@addOnSuccessListener
                            val now = SystemClock.elapsedRealtime()
                            if (faces.size != 1) {
                                if (now - lastFace > 1500) { readyAfterAbsence = true; blinkStep = 0 }
                                if (faces.size > 1) show("Uma pessoa por vez")
                            } else {
                                lastFace = now
                                if (!readyAfterAbsence) return@addOnSuccessListener
                                val face = faces[0]
                                val left = face.leftEyeOpenProbability
                                val right = face.rightEyeOpenProbability
                                if (left == null || right == null) { show("Olhe de frente para a câmera"); return@addOnSuccessListener }
                                if (blinkStep == 0 && left > .75f && right > .75f) blinkStep = 1
                                else if (blinkStep == 1 && left < .3f && right < .3f) blinkStep = 2
                                else if (blinkStep == 2 && left > .75f && right > .75f) {
                                    blinkStep = 0; readyAfterAbsence = false; capture(false)
                                }
                                if (!busy) show("Olhe para a câmera e pisque")
                            }
                        }.addOnCompleteListener { frame.close() }
                }
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_FRONT_CAMERA, display, imageCapture, analysis)
                cameraReady = true
                if (!scanning) show("Câmera pronta")
            } catch (e: Exception) { show("Falha ao abrir câmera: ${e.message}") }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun stopCamera() {
        ++cameraSequence
        cameraReady = false
        cameraProvider?.unbindAll()
    }

    private fun startScan() {
        if (prefs.getString("deviceId", null) == null) { show("Pareie o aparelho primeiro"); return }
        if (syncing) return
        if (!cameraReady || busy) { show("Aguarde a câmera ficar pronta"); return }
        syncing = true
        show("Sincronizando cadastros com o servidor...")
        worker.execute {
            try {
                val result = signedPost("/api/device/sync", "{}")
                val allowed = result.getJSONArray("personIds")
                val validIds = (0 until allowed.length()).map { allowed.getString(it) }.toSet()
                val templates = loadTemplates()
                val oldIds = templates.keys().asSequence().toList()
                oldIds.filter { it !in validIds }.forEach { templates.remove(it) }
                if (oldIds.size != templates.length()) saveTemplates(templates)
                runOnUiThread {
                    if (currentScreen != Screen.CONTROL) return@runOnUiThread
                    blinkStep = 0; readyAfterAbsence = true
                    setScreen(Screen.CAMERA)
                    scanning = true
                    show("Olhe para a câmera e pisque")
                }
            } catch (e: Exception) { show("Não foi possível sincronizar: ${e.message}") }
            finally { syncing = false }
        }
    }

    private fun capture(enrollment: Boolean) {
        if (busy || !cameraReady || !::imageCapture.isInitialized) { show("Aguarde a câmera ficar pronta"); return }
        if (prefs.getString("deviceId", null) == null) { show("Pareie o aparelho primeiro"); return }
        val ticket = if (enrollment) enrollmentTokenInput.text.toString().trim() else ""
        if (enrollment && ticket.length < 20) { show("Digite um código de cadastro válido"); return }
        busy = true; show("Capturando rosto...")
        val photo = File.createTempFile("capture_", ".jpg", cacheDir)
        val options = ImageCapture.OutputFileOptions.Builder(photo).build()
        imageCapture.takePicture(options, ContextCompat.getMainExecutor(this), object : ImageCapture.OnImageSavedCallback {
            override fun onError(error: ImageCaptureException) { photo.delete(); busy = false; show("Falha na câmera") }
            override fun onImageSaved(result: ImageCapture.OutputFileResults) {
                val original = BitmapFactory.decodeFile(photo.absolutePath)
                if (original == null) { photo.delete(); busy = false; show("Imagem inválida"); return }
                val orientation = ExifInterface(photo.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
                val degrees = when (orientation) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
                val bitmap = if (degrees == 0f) original else Bitmap.createBitmap(original, 0, 0, original.width, original.height, Matrix().apply { postRotate(degrees) }, true)
                photo.delete()
                detector.process(InputImage.fromBitmap(bitmap, 0)).addOnSuccessListener { faces ->
                    if (faces.size != 1) { busy = false; show("Capture exatamente um rosto"); return@addOnSuccessListener }
                    val bounds = faces[0].boundingBox
                    val output = ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output)
                    val jpeg = output.toByteArray()
                    worker.execute {
                        try {
                            val model = modelPath()
                            val embedding = Python.getInstance().getModule("recognition")
                                .callAttr("embed", jpeg, bounds.left, bounds.top, bounds.width(), bounds.height(), model).toString()
                            if (enrollment) enroll(ticket, embedding) else if (scanning) attempt(embedding)
                        } catch (e: Exception) { show("Falha no processamento facial: ${e.message}") }
                        finally { jpeg.fill(0); runOnUiThread { busy = false } }
                    }
                }.addOnFailureListener { busy = false; show("Falha ao detectar rosto") }
            }
        })
    }

    private fun modelPath(): String {
        val target = File(filesDir, "nn4.small2.v1.t7")
        if (!target.exists()) assets.open("nn4.small2.v1.t7").use { input -> target.outputStream().use { input.copyTo(it) } }
        return target.absolutePath
    }

    private fun validServer(server: String): Boolean = try {
        val url = URL(server)
        url.protocol == "https" && url.host.isNotBlank() && (url.path.isEmpty() || url.path == "/") && url.query == null && url.ref == null
    } catch (_: Exception) { false }

    private fun saveConnection() {
        val server = serverInput.text.toString().trim().trimEnd('/')
        if (!validServer(server)) { show("Informe uma URL HTTPS válida"); return }
        if (prefs.getString("deviceId", null) != null && prefs.getString("server", null) != server) {
            show("Para trocar de servidor, informe um novo código e toque em Parear aparelho")
            return
        }
        prefs.edit().putString("server", server).apply()
        show("Conexão salva. Informe o código para parear.")
    }

    private fun pair() {
        val server = serverInput.text.toString().trim().trimEnd('/')
        val token = pairTokenInput.text.toString().trim()
        if (!validServer(server) || token.length < 20) { show("Use HTTPS e um código de pareamento válido"); return }
        show("Pareando...")
        worker.execute {
            try {
                val key = signingKey()
                val response = post(server, "/api/device/pair", JSONObject()
                    .put("token", token).put("publicKey", Base64.encodeToString(key.public.encoded, Base64.NO_WRAP)).toString())
                val editor = prefs.edit().putString("server", server).putString("deviceId", response.getString("deviceId"))
                if (prefs.getString("server", null) != server) editor.remove("templates")
                editor.apply()
                runOnUiThread { pairTokenInput.text.clear(); pairedLabel.text = "Aparelho pareado com o servidor" }
                show("Aparelho pareado")
            } catch (e: Exception) { show("Pareamento falhou: ${e.message}") }
        }
    }

    private fun enroll(ticket: String, embedding: String) {
        val response = signedPost("/api/device/enroll", JSONObject().put("token", ticket).toString())
        val id = response.getString("personId")
        val templates = loadTemplates()
        templates.put(id, org.json.JSONArray(embedding))
        saveTemplates(templates)
        runOnUiThread { enrollmentTokenInput.text.clear() }
        show("Rosto cadastrado para ${response.getString("name")}")
    }

    private fun attempt(embedding: String) {
        val personId = Python.getInstance().getModule("recognition")
            .callAttr("match", embedding, loadTemplates().toString()).toString()
        val body = JSONObject().put("faceResult", if (personId.isBlank()) "no_match" else "matched")
            .put("deviceTime", java.time.Instant.now().toString())
        if (personId.isNotBlank()) body.put("personId", personId)
        try {
            val response = signedPost("/api/device/attempt", body.toString())
            if (response.getString("decision") == "allowed") show("ACESSO AUTORIZADO")
            else {
                val reason = when (response.optString("reason")) {
                    "payment_overdue" -> "Mensalidade vencida"
                    "access_disabled" -> "Acesso desativado no painel"
                    "inactive_person" -> "Cadastro inativo"
                    "unknown_person" -> "Cadastro indisponível"
                    "unknown_face" -> "Rosto não reconhecido"
                    "presence_failed" -> "Prova de presença falhou"
                    else -> "Acesso não autorizado"
                }
                show("ACESSO NEGADO — $reason")
            }
        } catch (_: Exception) {
            show("SEM CONFIRMAÇÃO — servidor indisponível")
        }
    }

    private fun signingKey(): java.security.KeyPair {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getCertificate("catraca-sign")
        if (existing != null) return java.security.KeyPair(existing.publicKey, store.getKey("catraca-sign", null) as java.security.PrivateKey)
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        generator.initialize(KeyGenParameterSpec.Builder("catraca-sign", KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256).build())
        return generator.generateKeyPair()
    }

    private fun aesKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("catraca-templates", null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder("catraca-templates", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }
    private fun loadTemplates(): JSONObject {
        val saved = prefs.getString("templates", null) ?: return JSONObject()
        val bytes = Base64.decode(saved, Base64.DEFAULT)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, aesKey(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
    }
    private fun saveTemplates(templates: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, aesKey())
        val encrypted = cipher.iv + cipher.doFinal(templates.toString().toByteArray(Charsets.UTF_8))
        prefs.edit().putString("templates", Base64.encodeToString(encrypted, Base64.NO_WRAP)).apply()
    }

    private fun signedPost(path: String, body: String): JSONObject {
        val server = prefs.getString("server", null) ?: error("Servidor não configurado")
        val device = prefs.getString("deviceId", null) ?: error("Aparelho não pareado")
        val timestamp = java.time.Instant.now().toString()
        val id = UUID.randomUUID().toString()
        val message = "$timestamp\n$id\n$body"
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(signingKey().private)
        signer.update(message.toByteArray(Charsets.UTF_8))
        val headers = mapOf("x-device-id" to device, "x-device-time" to timestamp,
            "x-request-id" to id, "x-device-signature" to Base64.encodeToString(signer.sign(), Base64.NO_WRAP))
        return post(server, path, body, headers)
    }
    private fun post(server: String, path: String, body: String, headers: Map<String, String> = emptyMap()): JSONObject {
        val connection = URL(server + path).openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 8000; connection.readTimeout = 8000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val data = (if (code in 200..299) connection.inputStream else connection.errorStream)
                .bufferedReader().use { it.readText() }
            val result = JSONObject(data)
            if (code !in 200..299) error(result.optString("error", "Erro HTTP $code"))
            return result
        } finally { connection.disconnect() }
    }
    override fun onPause() {
        if (currentScreen == Screen.CAMERA) setScreen(Screen.CONTROL)
        super.onPause()
    }
    override fun onDestroy() { scanning = false; stopCamera(); detector.close(); worker.shutdown(); super.onDestroy() }
}
