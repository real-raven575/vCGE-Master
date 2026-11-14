package app.vcge.vcge

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File

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
  }

  // Back in vCGE after Contacts has read the card: the one copy handed over is deleted (vCGE keeps no card).
  override fun onResume() {
    super.onResume()
    clearContactFiles()
  }

  // The app's own pages can reach "vcgeAndroid" (the APK has no internet, so no other page ever loads here). It is added
  // before the first page loads.
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(ContactBridge(), "vcgeAndroid")
  }

  private fun contactDir() = File(cacheDir, "contact")

  private fun clearContactFiles() {
    contactDir().listFiles()?.forEach { it.delete() }
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
        val name = fileName.replace(Regex("[^A-Za-z0-9 ._-]"), "_").trim().ifEmpty { "Contact.vcf" }
        val file = File(dir, if (name.endsWith(".vcf")) name else "$name.vcf")
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
  }
}
