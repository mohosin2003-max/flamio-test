package bd.flamio.attendancegpstest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
class GpsForegroundService:Service(),LocationListener{
 private lateinit var lm:LocationManager
 private val channel="flamio_gps_test"
 private val network=Executors.newSingleThreadExecutor()
 private var lastSentAt=0L
 override fun onCreate(){super.onCreate()
  if(Build.VERSION.SDK_INT>=26)(getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel(channel,"Flamio Attendance GPS",NotificationManager.IMPORTANCE_LOW))
  startForeground(1001,notification("Connecting to TEST Attendance"));lm=getSystemService(Context.LOCATION_SERVICE) as LocationManager
  if((getSharedPreferences("gps_test",Context.MODE_PRIVATE).getString("access_token","")?:"").isBlank()){add("AUTH_REQUIRED","Sign in with TEST Staff account first");stopSelf();return}
  try{lm.requestLocationUpdates(LocationManager.GPS_PROVIDER,10000L,5f,this,mainLooper);add("SERVICE_STARTED","Foreground GPS active; sending transitions to TEST Supabase")}catch(e:SecurityException){add("PERMISSION_ERROR",e.message?:"Permission denied");stopSelf()}catch(e:Exception){add("GPS_START_ERROR",e.message?:"Could not start GPS");stopSelf()}
 }
 override fun onLocationChanged(location:Location){if(location.accuracy>50f){add("GPS_IGNORED","accuracy ${location.accuracy.toInt()}m exceeds 50m limit");return};val now=System.currentTimeMillis();if(now-lastSentAt<8000L)return;lastSentAt=now
  add("GPS_FIX","accuracy=${location.accuracy.toInt()}m; checking active Duty/geofence")
  network.execute{try{val response=SupabaseGpsClient.send(this,location.latitude,location.longitude,location.accuracy,location.time);val j=JSONObject(response);val recorded=j.optBoolean("recorded",false);val event=j.optString("eventType",j.optString("reason","no_transition"));add(if(recorded)"EVENT_SAVED" else "NO_EVENT",event);(getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(1001,notification(if(recorded)"TEST event saved: $event" else "GPS active · $event"))}catch(e:Exception){add("SEND_ERROR",e.message?:"Could not send GPS event");(getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(1001,notification("GPS active · event send failed; check log"))}}
 }
 override fun onDestroy(){try{lm.removeUpdates(this)}catch(_:Exception){};network.shutdown();add("SERVICE_STOPPED","GPS service stopped");super.onDestroy()}
 override fun onBind(intent:Intent?):IBinder?=null
 override fun onProviderDisabled(provider:String){add("GPS_DISABLED",provider)}
 override fun onProviderEnabled(provider:String){add("GPS_ENABLED",provider)}
 @Deprecated("Deprecated API") override fun onStatusChanged(provider:String?,status:Int,extras:Bundle?){}
 private fun notification(s:String):Notification{val b=if(Build.VERSION.SDK_INT>=26)Notification.Builder(this,channel)else Notification.Builder(this);return b.setContentTitle("Flamio Attendance GPS · TEST").setContentText(s).setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build()}
 private fun add(type:String,msg:String){val p=getSharedPreferences("gps_test",Context.MODE_PRIVATE);val old=p.getString("log","")?:"";val t=SimpleDateFormat("HH:mm:ss",Locale.US).format(Date());p.edit().putString("log",(old+"\n$t [$type] $msg").takeLast(16000)).apply()}
 companion object{fun readLog(c:Context)=c.getSharedPreferences("gps_test",Context.MODE_PRIVATE).getString("log","No GPS events yet")?:"No GPS events yet"}
}