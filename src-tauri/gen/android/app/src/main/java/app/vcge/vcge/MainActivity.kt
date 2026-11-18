package app.vcge.vcge

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.provider.Telephony
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge to edge draws the app under the status bar, the navigation bar and any camera cut-out (raven575's phone run,
    // 2026-11-14: the top of vCGE was hidden under the status bar). Pad the app by those bars, and by the keyboard while
    // it is open, so nothing sits under them. The bars keep the theme's colour.
    val root = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsetsCompat.CONSUMED
    }
    clearContactFiles()
    clearShareFiles()
    deleteFingerprintKey()
    fingerprintPrompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), fingerprintCallback)
  }

  // Back in vCGE after Contacts has read the card: the one copy handed over is deleted (vCGE keeps no card).
  override fun onResume() {
    super.onResume()
    clearContactFiles()
  }

  // The app's own pages can reach "vcgeAndroid" (the APK has no internet, so no other page ever loads here). It is added
  // before the first page loads.
  // The page asks for links, shares, saves and printing through it: the WebView opens none of them itself (raven575's
  // phone run, 2026-11-14 22:2x UTC: Email and Text message replaced the app with "Webpage not available", Share said
  // "not available", Print did nothing).
  private var page: WebView? = null

  override fun onWebViewCreate(webView: WebView) {
    page = webView
    webView.addJavascriptInterface(ContactBridge(), "vcgeAndroid")
  }

  private fun contactDir() = File(cacheDir, "contact")

  private fun clearContactFiles() {
    contactDir().listFiles()?.forEach { it.delete() }
  }

  // Shared cards stay until the next share or the next start, not just until the person comes back: an app such as Drive
  // may read the file after vCGE is in front again.
  private fun shareDir() = File(cacheDir, "share")

  private fun clearShareFiles() {
    shareDir().listFiles()?.forEach { it.delete() }
  }

  private fun safeName(fileName: String, ending: String, fallback: String): String {
    val name = fileName.replace(Regex("[^A-Za-z0-9 ._-]"), "_").trim().ifEmpty { fallback }
    return if (name.endsWith(ending)) name else "$name$ending"
  }

  // True when an app took the intent, false when no app on the phone handles it.
  private fun launch(intent: Intent): Boolean {
    return try {
      startActivity(intent)
      true
    } catch (e: ActivityNotFoundException) {
      false
    }
  }

  // Fingerprint unlock (raven575's Android run, 2026-11-16: a PIN was set but no fingerprint option showed, because the
  // WebView offers web pages no fingerprint check). The bridge gives the page the same kind of proof the browser does:
  // a key pair made inside the phone's secure hardware (Android Keystore) whose private half signs only after a strong
  // biometric check (fingerprint, or a face check the phone rates as strong). The page keeps the public half for this
  // session and checks each signature itself. The key is for this session only: deleted when the page clears it, at
  // every start, and by Android itself if the phone's fingerprints change.
  private val fingerprintAlias = "vcge-session-unlock"

  private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun deleteFingerprintKey() {
    try {
      keyStore().deleteEntry(fingerprintAlias)
    } catch (e: Exception) {
      // No key, or the keystore is unavailable: nothing to delete.
    }
  }

  // Hands one result back to the page: window.__vcgeFingerprintDone(id, status, signature). Status is "ok" (signature
  // is the DER signature, base64), "cancelled", "failed", "changed" (fingerprints changed since setup) or "error".
  private fun fingerprintDone(id: String, status: String, signature: String = "") {
    val view = page ?: return
    val safeId = id.replace(Regex("[^A-Za-z0-9_-]"), "")
    val js = "window.__vcgeFingerprintDone && window.__vcgeFingerprintDone('$safeId', '$status', '$signature')"
    runOnUiThread { view.evaluateJavascript(js, null) }
  }

  // One prompt for the activity, made in onCreate (androidx.biometric wants it made before the activity starts). The
  // request it is answering (id and the challenge to sign) is held here while the prompt is up.
  private var fingerprintPrompt: BiometricPrompt? = null
  private var fingerprintPending: Pair<String, ByteArray>? = null

  private val fingerprintCallback = object : BiometricPrompt.AuthenticationCallback() {
    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
      val (id, data) = fingerprintPending ?: return
      fingerprintPending = null
      try {
        val s = result.cryptoObject?.signature ?: throw IllegalStateException("no signature")
        s.update(data)
        fingerprintDone(id, "ok", Base64.encodeToString(s.sign(), Base64.NO_WRAP))
      } catch (e: Exception) {
        fingerprintDone(id, "error")
      }
    }

    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
      val (id, _) = fingerprintPending ?: return
      fingerprintPending = null
      val cancelled = errorCode == BiometricPrompt.ERROR_USER_CANCELED || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
        || errorCode == BiometricPrompt.ERROR_CANCELED
      fingerprintDone(id, if (cancelled) "cancelled" else "failed")
    }
    // onAuthenticationFailed (one finger not recognised) is left to the prompt, which lets the person try again.
  }

  inner class ContactBridge {
    // Save .vcf on Android: the WebView cannot download files, so the card is handed to the phone's Contacts app, which
    // shows its own "add contact" screen. The file lives in the app's cache only until the person comes back to vCGE.
    // False when it could not be written or no app on the phone opens a contact card.
    @JavascriptInterface
    fun addContact(vcard: String, fileName: String): Boolean {
      return try {
        val dir = contactDir()
        dir.mkdirs()
        clearContactFiles()
        val file = File(dir, safeName(fileName, ".vcf", "Contact.vcf"))
        file.writeText(vcard, Charsets.UTF_8)
        val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW)
          .setDataAndType(uri, "text/x-vcard")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        startActivity(intent)
        true
      } catch (e: ActivityNotFoundException) {
        clearContactFiles()
        false
      } catch (e: Exception) {
        clearContactFiles()
        false
      }
    }

    // Share...: the .vcf goes to Android's share menu, where the person picks the app.
    @JavascriptInterface
    fun shareContact(vcard: String, fileName: String, title: String): Boolean {
      return try {
        val dir = shareDir()
        dir.mkdirs()
        clearShareFiles()
        val file = File(dir, safeName(fileName, ".vcf", "Contact.vcf"))
        file.writeText(vcard, Charsets.UTF_8)
        val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND)
          .setType("text/x-vcard")
          .putExtra(Intent.EXTRA_STREAM, uri)
          .putExtra(Intent.EXTRA_SUBJECT, title)
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(file.name, uri)
        launch(Intent.createChooser(send, title))
      } catch (e: Exception) {
        clearShareFiles()
        false
      }
    }

    // Email: a new message in the phone's mail app (only mail apps answer "mailto:"), with the subject and body filled in.
    @JavascriptInterface
    fun email(subject: String, body: String): Boolean {
      return launch(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"))
        .putExtra(Intent.EXTRA_SUBJECT, subject)
        .putExtra(Intent.EXTRA_TEXT, body))
    }

    // Text message: a new message in the phone's messaging app, with no number picked, holding the body.
    @JavascriptInterface
    fun sms(body: String): Boolean {
      return launch(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")).putExtra("sms_body", body))
    }

    // The .vcf for Email or Text with the file attached (raven575's phone run, 2026-11-16: "attach .vcf" or "inline
    // text", the person's choice), written to the share folder like Share... and kept until the next share or start.
    private fun attachment(vcard: String, fileName: String): Pair<File, Uri> {
      val dir = shareDir()
      dir.mkdirs()
      clearShareFiles()
      val file = File(dir, safeName(fileName, ".vcf", "Contact.vcf"))
      file.writeText(vcard, Charsets.UTF_8)
      return file to FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", file)
    }

    // Email with the .vcf attached: a new message in a mail app (the selector keeps it to apps that answer "mailto:"),
    // with the subject, the readable details and the file. False when no mail app takes it.
    @JavascriptInterface
    fun emailFile(vcard: String, fileName: String, subject: String, body: String): Boolean {
      return try {
        val (file, uri) = attachment(vcard, fileName)
        val send = Intent(Intent.ACTION_SEND)
          .setType("text/x-vcard")
          .putExtra(Intent.EXTRA_STREAM, uri)
          .putExtra(Intent.EXTRA_SUBJECT, subject)
          .putExtra(Intent.EXTRA_TEXT, body)
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(file.name, uri)
        send.selector = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"))
        launch(send)
      } catch (e: Exception) {
        clearShareFiles()
        false
      }
    }

    // Text message with the .vcf attached (sent as a picture message): the phone's default messaging app, or the share
    // menu when the phone names none. False when no app takes it.
    @JavascriptInterface
    fun smsFile(vcard: String, fileName: String, body: String): Boolean {
      return try {
        val (file, uri) = attachment(vcard, fileName)
        val send = Intent(Intent.ACTION_SEND)
          .setType("text/x-vcard")
          .putExtra(Intent.EXTRA_STREAM, uri)
          .putExtra("sms_body", body)
          .putExtra(Intent.EXTRA_TEXT, body)
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(file.name, uri)
        val messages = Telephony.Sms.getDefaultSmsPackage(this@MainActivity)
        if (messages != null) launch(send.setPackage(messages)) else launch(Intent.createChooser(send, "Text message"))
      } catch (e: Exception) {
        clearShareFiles()
        false
      }
    }

    // Save QR image: the PNG goes to Downloads (Android 10 and later need no storage permission for that). False on older
    // Android, or when it could not be written.
    @JavascriptInterface
    fun savePng(base64: String, fileName: String): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
      return try {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, safeName(fileName, ".png", "QR.png"))
          put(MediaStore.Downloads.MIME_TYPE, "image/png")
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
        try {
          contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IllegalStateException("no stream")
          values.clear()
          values.put(MediaStore.Downloads.IS_PENDING, 0)
          contentResolver.update(uri, values, null, null)
          true
        } catch (e: Exception) {
          contentResolver.delete(uri, null, null)
          false
        }
      } catch (e: Exception) {
        false
      }
    }

    // Print or save as PDF: Android's own print screen for the page (print.css shows only the print sheet). The job name
    // is the PDF's name.
    @JavascriptInterface
    fun print(jobName: String): Boolean {
      val view = page ?: return false
      runOnUiThread {
        try {
          val printer = getSystemService(PRINT_SERVICE) as PrintManager
          val name = jobName.ifBlank { "vCGE" }
          printer.print(name, view.createPrintDocumentAdapter(name), PrintAttributes.Builder().build())
        } catch (e: Exception) {
          // Nothing more to do: the person sees no print screen and can try again.
        }
      }
      return true
    }

    // "ok" when the phone has a strong fingerprint (or face) check set up; otherwise why not ("none" = no sensor,
    // "not-enrolled" = no fingerprint added in Settings, "unavailable" = sensor busy or off).
    @JavascriptInterface
    fun fingerprintStatus(): String {
      return when (BiometricManager.from(this@MainActivity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)) {
        BiometricManager.BIOMETRIC_SUCCESS -> "ok"
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "not-enrolled"
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "none"
        else -> "unavailable"
      }
    }

    // Makes this session's key pair (any older one is replaced) and returns the public half (X.509 SubjectPublicKeyInfo,
    // base64), or "" when it could not. No fingerprint is asked for here: signing asks for it.
    @JavascriptInterface
    fun fingerprintSetUp(): String {
      return try {
        deleteFingerprintKey()
        val spec = KeyGenParameterSpec.Builder(fingerprintAlias, KeyProperties.PURPOSE_SIGN)
          .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
          .setDigests(KeyProperties.DIGEST_SHA256)
          .setUserAuthenticationRequired(true)
          .setInvalidatedByBiometricEnrollment(true)
          .apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
          }
          .build()
        val pair = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply { initialize(spec) }.generateKeyPair()
        Base64.encodeToString(pair.public.encoded, Base64.NO_WRAP)
      } catch (e: Exception) {
        deleteFingerprintKey()
        ""
      }
    }

    // Asks for the fingerprint, then signs the page's challenge (base64) with this session's key. The answer comes back
    // later through fingerprintDone(id, ...); this returns false only when the prompt could not be started.
    @JavascriptInterface
    fun fingerprintSign(id: String, challenge: String, title: String): Boolean {
      val (signer, data) = try {
        val bytes = Base64.decode(challenge, Base64.DEFAULT)
        val key = keyStore().getKey(fingerprintAlias, null) as? PrivateKey ?: return false
        Signature.getInstance("SHA256withECDSA").apply { initSign(key) } to bytes
      } catch (e: KeyPermanentlyInvalidatedException) {
        deleteFingerprintKey()
        fingerprintDone(id, "changed")
        return true
      } catch (e: Exception) {
        return false
      }
      runOnUiThread {
        val prompt = fingerprintPrompt
        if (prompt == null) { fingerprintDone(id, "error"); return@runOnUiThread }
        try {
          fingerprintPending = id to data
          val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title.ifBlank { "Unlock vCGE" })
            .setNegativeButtonText("Use PIN")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()
          prompt.authenticate(info, BiometricPrompt.CryptoObject(signer))
        } catch (e: Exception) {
          fingerprintPending = null
          fingerprintDone(id, "error")
        }
      }
      return true
    }

    // Fingerprint turned off, the PIN changed or the session ended: this session's key is deleted.
    @JavascriptInterface
    fun fingerprintClear() {
      deleteFingerprintKey()
    }
  }
}
