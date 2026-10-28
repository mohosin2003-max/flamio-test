package bd.flamio.attendancegpstest

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
 private lateinit var log: TextView
 override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState)
  val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(24,36,24,24) }
  root.addView(TextView(this).apply { text="Flamio Attendance GPS Test"; textSize=24f })
  root.addView(TextView(this).apply { text="TEST HARNESS ONLY — local GPS log; not connected to Flamio/Supabase or Owner alerts."; textSize=16f })
  log=TextView(this).apply { text="No GPS events yet" }; root.addView(log)
  root.addView(Button(this).apply { text="Request permissions"; setOnClickListener { val p=mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION); if(Build.VERSION.SDK_INT>=29)p.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION); if(Build.VERSION.SDK_INT>=33)p.add(Manifest.permission.POST_NOTIFICATIONS); requestPermissions(p.toTypedArray(),1) } })
  root.addView(Button(this).apply { text="Start GPS foreground service"; setOnClickListener { if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED){ val i=Intent(this@MainActivity,GpsForegroundService::class.java); if(Build.VERSION.SDK_INT>=26)startForegroundService(i) else startService(i) } else log.text="Grant location permission first" } })
  root.addView(Button(this).apply { text="Refresh local log"; setOnClickListener { log.text=GpsForegroundService.readLog(this@MainActivity) } })
  root.addView(Button(this).apply { text="Stop service"; setOnClickListener { stopService(Intent(this@MainActivity,GpsForegroundService::class.java)); log.text=GpsForegroundService.readLog(this@MainActivity) } })
  setContentView(root); log.text=GpsForegroundService.readLog(this)
 }
}
