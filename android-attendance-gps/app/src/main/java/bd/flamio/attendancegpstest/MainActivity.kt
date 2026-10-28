package bd.flamio.attendancegpstest
import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors
class MainActivity:Activity(){
 private val executor=Executors.newSingleThreadExecutor()
 private val prefs by lazy{getSharedPreferences("gps_test",MODE_PRIVATE)}
 private lateinit var status:TextView
 private lateinit var readiness:TextView
 private lateinit var email:EditText
 private lateinit var password:EditText
 private lateinit var apiKey:EditText
 private lateinit var urlField:EditText
 override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState)
  val root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(24,28,24,24)}
  val scroll=ScrollView(this);val content=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL}
  content.addView(TextView(this).apply{text="Flamio Attendance GPS";textSize=24f})
  content.addView(TextView(this).apply{text="TEST ONLY. Sign in with a TEST Staff account. This app sends GPS transitions only to the TEST Supabase project. Never use production credentials.";textSize=14f})
  content.addView(TextView(this).apply{text="TEST Supabase URL"})
  urlField=EditText(this).apply{setText(prefs.getString("supabase_url","https://avwrptztixaketchgmsh.supabase.co"));hint="https://your-test-project.supabase.co";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI}
  content.addView(urlField)
  content.addView(TextView(this).apply{text="TEST publishable / anon key"})
  apiKey=EditText(this).apply{setText(prefs.getString("api_key","sb_publishable_SGkE79RC4zt4f8u3s6Oxmg_130cEqjv"));hint="TEST public key";inputType=InputType.TYPE_CLASS_TEXT}
  content.addView(apiKey)
  content.addView(TextView(this).apply{text="TEST Staff email"})
  email=EditText(this).apply{setText(prefs.getString("user_email",""));hint="Staff email";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS}
  content.addView(email)
  content.addView(TextView(this).apply{text="TEST Staff password"})
  password=EditText(this).apply{hint="Staff password";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD}
  content.addView(password)
  content.addView(Button(this).apply{text="Sign in to TEST Attendance";setOnClickListener{signIn()}})

  content.addView(TextView(this).apply{textSize=14f;text="\nWhy these permissions?\n• Precise location: checks whether you are inside the shop area during Duty.\n• \"Allow all the time\" location: lets exits/returns be noticed while the phone is in your pocket or the screen is off.\n• Notifications: shows the ongoing GPS notice so you always know tracking is on.\n• Battery \"Unrestricted\": some phones stop background apps to save battery. Android may still pause tracking; this cannot be fully bypassed.\nOnly exit/return times, distance and accuracy are sent — not your route."})
  readiness=TextView(this).apply{textSize=14f};content.addView(readiness)
  content.addView(Button(this).apply{text="1. Allow precise location & notifications";setOnClickListener{val p=mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION);if(Build.VERSION.SDK_INT>=33)p.add(Manifest.permission.POST_NOTIFICATIONS);requestPermissions(p.toTypedArray(),1)}})
  content.addView(Button(this).apply{text="2. Allow location all the time";setOnClickListener{requestBackground()}})
  content.addView(Button(this).apply{text="3. Open battery settings (choose Unrestricted)";setOnClickListener{openBatterySettings()}})

  status=TextView(this).apply{textSize=14f};content.addView(status)
  content.addView(Button(this).apply{text="Start GPS during active Duty";setOnClickListener{if(!SupabaseGpsClient.isSignedIn(this@MainActivity))status.text="Sign in with TEST Staff account first." else if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED){val i=Intent(this@MainActivity,GpsForegroundService::class.java);if(Build.VERSION.SDK_INT>=26)startForegroundService(i)else startService(i);status.text="GPS started. Start Duty first in the TEST Attendance app."+(if(!hasBackground())"\nNote: without \"all the time\" location, tracking may stop when the screen is off." else "")}else status.text="Allow precise location first (step 1)."}})
  content.addView(Button(this).apply{text="Refresh event log";setOnClickListener{showStatus()}})
  content.addView(Button(this).apply{text="Stop GPS";setOnClickListener{stopService(Intent(this@MainActivity,GpsForegroundService::class.java));showStatus()}})
  content.addView(Button(this).apply{text="Sign out";setOnClickListener{stopService(Intent(this@MainActivity,GpsForegroundService::class.java));prefs.edit().remove("access_token").remove("refresh_token").remove("expires_at").apply();status.text="Signed out; GPS stopped. ${GpsForegroundService.queueFor(this@MainActivity).pending().size} unsent reading(s) are kept and will send after you sign in and start GPS again."}})
  scroll.addView(content);root.addView(scroll);setContentView(root)
  showStatus()
 }
 override fun onResume(){super.onResume();updateReadiness()}
 override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,grantResults:IntArray){super.onRequestPermissionsResult(requestCode,permissions,grantResults);updateReadiness()}

 private fun hasFine()=checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED
 private fun hasBackground()=Build.VERSION.SDK_INT<29||checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)==PackageManager.PERMISSION_GRANTED
 private fun batteryUnrestricted()=(getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)

 // Android 11+ only allows "all the time" from system settings, and only after precise location.
 private fun requestBackground(){
  if(!hasFine()){readiness.text="Do step 1 first.";return}
  if(hasBackground()){updateReadiness();return}
  if(Build.VERSION.SDK_INT>=30)openAppSettings("In Permissions → Location, choose \"Allow all the time\", then come back.")
  else requestPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION),2)
 }
 // User-initiated only: opens the system list; no automatic prompts or exemption requests.
 private fun openBatterySettings(){
  if(batteryUnrestricted()){updateReadiness();return}
  try{startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));readiness.text="Find \"Flamio Attendance GPS TEST\" and choose Unrestricted / Don't optimise, then come back."}
  catch(_:Exception){openAppSettings("Open Battery and choose Unrestricted, then come back.")}
 }
 private fun openAppSettings(hint:String){
  try{startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.fromParts("package",packageName,null)));readiness.text=hint}catch(_:Exception){readiness.text="Open Android Settings → Apps → Flamio Attendance GPS TEST. $hint"}
 }
 private fun updateReadiness(){
  if(!::readiness.isInitialized)return
  val notif=Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED
  fun mark(b:Boolean)=if(b)"✓" else "✗"
  readiness.text="Setup: ${mark(hasFine())} precise location · ${mark(notif)} notifications · ${mark(hasBackground())} all-the-time location · ${mark(batteryUnrestricted())} battery unrestricted"
 }
 private fun showStatus(){
  val q=GpsForegroundService.queueFor(this)
  status.text="Session: "+(prefs.getString("user_email","").takeUnless{it.isNullOrBlank()}?:"not signed in")+
   "\nWaiting to send: ${q.pending().size} · Refused/held: ${q.held().size} · Older held entries trimmed: ${q.heldOverflowCount()}\n"+GpsForegroundService.readLog(this)
 }
 private fun signIn(){val url=urlField.text.toString().trim();val key=apiKey.text.toString().trim();val user=email.text.toString().trim();val pass=password.text.toString();if(user.isBlank()||pass.isBlank()){status.text="Enter TEST Staff email and password.";return};status.text="Signing in to TEST Supabase…"
  executor.execute{try{val signed=SupabaseGpsClient.signIn(this,url,key,user,pass);runOnUiThread{password.setText("");status.text="Signed in: $signed\nStart a Duty in the TEST Attendance app, then start GPS here."}}catch(e:Exception){runOnUiThread{status.text="Sign-in failed: "+(e.message?:"Unknown error")}}}
 }
 override fun onDestroy(){executor.shutdown();super.onDestroy()}
}
