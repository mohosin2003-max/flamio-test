package bd.flamio.attendancegpstest
import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
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
  status=TextView(this).apply{textSize=14f};content.addView(status)
  content.addView(Button(this).apply{text="Request GPS permissions";setOnClickListener{val p=mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION);if(Build.VERSION.SDK_INT>=29)p.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION);if(Build.VERSION.SDK_INT>=33)p.add(Manifest.permission.POST_NOTIFICATIONS);requestPermissions(p.toTypedArray(),1)}})
  content.addView(Button(this).apply{text="Start GPS during active Duty";setOnClickListener{if((prefs.getString("access_token","")?:"").isBlank())status.text="Sign in with TEST Staff account first." else if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED){val i=Intent(this@MainActivity,GpsForegroundService::class.java);if(Build.VERSION.SDK_INT>=26)startForegroundService(i)else startService(i);status.text="GPS started. Start Duty first in the TEST Attendance app."}else status.text="Grant GPS permissions first."}})
  content.addView(Button(this).apply{text="Refresh event log";setOnClickListener{status.text=GpsForegroundService.readLog(this@MainActivity)}})
  content.addView(Button(this).apply{text="Stop GPS";setOnClickListener{stopService(Intent(this@MainActivity,GpsForegroundService::class.java));status.text=GpsForegroundService.readLog(this@MainActivity)}})
  content.addView(Button(this).apply{text="Sign out";setOnClickListener{stopService(Intent(this@MainActivity,GpsForegroundService::class.java));prefs.edit().remove("access_token").remove("refresh_token").remove("expires_at").apply();status.text="Signed out; GPS stopped."}})
  scroll.addView(content);root.addView(scroll);setContentView(root)
  status.text="Session: "+(prefs.getString("user_email","").takeUnless{it.isNullOrBlank()}?:"not signed in")+"\n"+GpsForegroundService.readLog(this)
 }
 private fun signIn(){val url=urlField.text.toString().trim();val key=apiKey.text.toString().trim();val user=email.text.toString().trim();val pass=password.text.toString();if(user.isBlank()||pass.isBlank()){status.text="Enter TEST Staff email and password.";return};status.text="Signing in to TEST Supabase…"
  executor.execute{try{val signed=SupabaseGpsClient.signIn(this,url,key,user,pass);runOnUiThread{password.setText("");status.text="Signed in: $signed\nStart a Duty in the TEST Attendance app, then start GPS here."}}catch(e:Exception){runOnUiThread{status.text="Sign-in failed: "+(e.message?:"Unknown error")}}}
 }
 override fun onDestroy(){executor.shutdown();super.onDestroy()}
}