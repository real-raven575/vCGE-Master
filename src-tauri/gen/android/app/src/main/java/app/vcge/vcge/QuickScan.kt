package app.vcge.vcge

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.TileService
import android.widget.RemoteViews

// Quick Scan (raven575, 2026-11-24): one press opens vCGE straight into Quick Scan. Every way in (the long-press
// shortcut in res/xml/shortcuts.xml, the home-screen widget and the pulldown tile below) sends MainActivity this action;
// MainActivity tells the page (vcgeAndroid.quickLaunch, or the vcge-quick-scan event when vCGE is already open).
// None of them reads or keeps anything: no contact ever passes through here.
const val QUICK_SCAN_ACTION = "app.vcge.vcge.QUICK_SCAN"

fun quickScanIntent(context: Context): Intent =
  Intent(QUICK_SCAN_ACTION).setClass(context, MainActivity::class.java)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

fun quickScanPendingIntent(context: Context): PendingIntent =
  PendingIntent.getActivity(context, 0, quickScanIntent(context), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

// The home-screen widget: one themed button (res/layout/widget_quick_scan.xml).
class QuickScanWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val views = RemoteViews(context.packageName, R.layout.widget_quick_scan)
    views.setOnClickPendingIntent(R.id.quick_scan_button, quickScanPendingIntent(context))
    ids.forEach { manager.updateAppWidget(it, views) }
  }
}

// The pulldown (Quick Settings) tile. On a locked phone it asks for the unlock first: contacts are never opened over the
// lock screen.
class QuickScanTile : TileService() {
  override fun onClick() {
    super.onClick()
    if (isLocked) unlockAndRun { open() } else open()
  }

  private fun open() {
    if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(quickScanPendingIntent(this))
    else @Suppress("DEPRECATION") startActivityAndCollapse(quickScanIntent(this))
  }
}
