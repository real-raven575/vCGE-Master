package app.vcge.vcge

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.ContactsContract
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.provider.Telephony
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Opened by Quick Scan (QuickScan.kt): the page asks once, as it starts (vcgeAndroid.quickLaunch).
    quickPending = intent?.action == QUICK_SCAN_ACTION
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
  }

  // Quick Scan pressed while vCGE is already open: the page starts it at once (main.js listens for vcge-quick-scan).
  @Volatile private var quickPending = false

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (intent.action == QUICK_SCAN_ACTION) {
      page?.post { page?.evaluateJavascript("window.dispatchEvent(new Event('vcge-quick-scan'))", null) }
    }
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

  inner class ContactBridge {
    // Quick Scan: true once if vCGE was opened by the Quick Scan shortcut, widget or tile.
    @JavascriptInterface
    fun quickLaunch(): Boolean {
      val pending = quickPending
      quickPending = false
      return pending
    }

    // Quick Scan's hand-off: the phone's own Create contact screen, filled in (ACTION_INSERT needs no contacts
    // permission; the person checks the details there and taps Save). `json` comes from MOD08 newContactFields.
    // False when no app on the phone takes it: the page then hands over the .vcf as Save .vcf does.
    @JavascriptInterface
    fun newContact(json: String): Boolean {
      return try {
        val c = JSONObject(json)
        val intent = Intent(ContactsContract.Intents.Insert.ACTION).setType(ContactsContract.RawContacts.CONTENT_TYPE)
        fun extra(key: String, value: String) { if (value.isNotBlank()) intent.putExtra(key, value) }
        extra(ContactsContract.Intents.Insert.NAME, c.optString("name"))
        extra(ContactsContract.Intents.Insert.COMPANY, c.optString("organization"))
        extra(ContactsContract.Intents.Insert.JOB_TITLE, c.optString("jobTitle"))
        extra(ContactsContract.Intents.Insert.NOTES, c.optString("notes"))
        extra(ContactsContract.Intents.Insert.POSTAL, c.optString("address"))
        if (c.optString("address").isNotBlank()) intent.putExtra(ContactsContract.Intents.Insert.POSTAL_TYPE, postalType(c.optString("addressType")))
        val rows = ArrayList<ContentValues>()
        eachEntry(c.optJSONArray("phones")) { type, value -> rows.add(ContentValues().apply {
          put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
          put(ContactsContract.CommonDataKinds.Phone.NUMBER, value)
          put(ContactsContract.CommonDataKinds.Phone.TYPE, phoneType(type))
        }) }
        eachEntry(c.optJSONArray("emails")) { type, value -> rows.add(ContentValues().apply {
          put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE)
          put(ContactsContract.CommonDataKinds.Email.ADDRESS, value)
          put(ContactsContract.CommonDataKinds.Email.TYPE, emailType(type))
        }) }
        eachEntry(c.optJSONArray("websites")) { type, value -> rows.add(ContentValues().apply {
          put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Website.CONTENT_ITEM_TYPE)
          put(ContactsContract.CommonDataKinds.Website.URL, value)
          put(ContactsContract.CommonDataKinds.Website.TYPE, websiteType(type))
        }) }
        if (rows.isNotEmpty()) intent.putParcelableArrayListExtra(ContactsContract.Intents.Insert.DATA, rows)
        launch(intent)
      } catch (e: Exception) {
        false
      }
    }

    private fun eachEntry(list: JSONArray?, each: (String, String) -> Unit) {
      if (list == null) return
      for (i in 0 until list.length()) {
        val entry = list.optJSONObject(i) ?: continue
        val value = entry.optString("value").trim()
        if (value.isNotEmpty()) each(entry.optString("type"), value)
      }
    }

    // vCGE's types (src/share/contactOptions.js) to Android's.
    private fun phoneType(type: String): Int = when (type) {
      "mobile" -> ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE
      "work" -> ContactsContract.CommonDataKinds.Phone.TYPE_WORK
      "home" -> ContactsContract.CommonDataKinds.Phone.TYPE_HOME
      "main" -> ContactsContract.CommonDataKinds.Phone.TYPE_MAIN
      "workFax" -> ContactsContract.CommonDataKinds.Phone.TYPE_FAX_WORK
      "homeFax" -> ContactsContract.CommonDataKinds.Phone.TYPE_FAX_HOME
      "pager" -> ContactsContract.CommonDataKinds.Phone.TYPE_PAGER
      else -> ContactsContract.CommonDataKinds.Phone.TYPE_OTHER
    }
    private fun emailType(type: String): Int = when (type) {
      "work" -> ContactsContract.CommonDataKinds.Email.TYPE_WORK
      "personal" -> ContactsContract.CommonDataKinds.Email.TYPE_HOME
      else -> ContactsContract.CommonDataKinds.Email.TYPE_OTHER
    }
    private fun websiteType(type: String): Int = when (type) {
      "work" -> ContactsContract.CommonDataKinds.Website.TYPE_WORK
      "personal" -> ContactsContract.CommonDataKinds.Website.TYPE_HOME
      "blog" -> ContactsContract.CommonDataKinds.Website.TYPE_BLOG
      else -> ContactsContract.CommonDataKinds.Website.TYPE_OTHER
    }
    private fun postalType(type: String): Int = when (type) {
      "home" -> ContactsContract.CommonDataKinds.StructuredPostal.TYPE_HOME
      "work" -> ContactsContract.CommonDataKinds.StructuredPostal.TYPE_WORK
      else -> ContactsContract.CommonDataKinds.StructuredPostal.TYPE_OTHER
    }

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
    // with the subject, the readable details and the file. Some phones find no app for that pair (a Samsung with Gmail
    // and Outlook, Play test 2026-11-23), so the share menu opens instead, as Share... does. False when nothing takes it.
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
        val mailOnly = Intent(send).apply { selector = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")) }
        launch(mailOnly) || launch(Intent.createChooser(send, subject))
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
  }
}
