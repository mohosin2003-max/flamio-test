package bd.flamio.attendancegpstest

import android.app.*
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class GpsForegroundService: Service(), LocationListener {
 private lateinit var lm:LocationManager
 private val channel="flamio_gps_test"
 override fun onCreate(){ super.onCreate(); if(Build.VERSION.SDK_INT>=26){(getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel(channel,"Flamio GPS test",NotificationManager.IMPORTANCE_LOW))}; startForeground(1001,notification("Waiting for GPS")); lm=getSystemService(Context.LOCATION_SERVICE) as LocationManager; try { lm.requestLocationUpdates(LocationManager.GPS_PROVIDER,10000L,5f,this,mainLooper); add("SERVICE_STARTED","GPS foreground service started") } catch(e:SecurityException){add("PERMISSION_ERROR",e.message?:"Permission denied");stopSelf()} }
 override fun onLocationChanged(location:Location){add("GPS_FIX","accuracy=${location.accuracy}m");(getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(1001,notification("GPS active · accuracy ${location.accuracy.toInt()}m"))}
 override fun onDestroy(){try{lm.removeUpdates(this)}catch(_:Exception){};add("SERVICE_STOPPED","GPS service stopped");super.onDestroy()}
 override fun onBind(intent:Intent?):IBinder?=null
 override fun onProviderDisabled(provider:String){add("GPS_DISABLED",provider)}
 override fun onProviderEnabled(provider:String){add("GPS_ENABLED",provider)}
 @Deprecated("Deprecated API") override fun onStatusChanged(provider:String?,status:Int,extras:Bundle?){}
 private fun notification(s:String):Notification { val b=if(Build.VERSION.SDK_INT>=26)Notification.Builder(this,channel) else Notification.Builder(this); return b.setContentTitle("Flamio GPS test running").setContentText(s).setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build() }
 private fun add(type:String,msg:String){val p=getSharedPreferences("gps_test",Context.MODE_PRIVATE);val old=p.getString("log","")?:"";val t=SimpleDateFormat("HH:mm:ss",Locale.US).format(Date());p.edit().putString("log",(old+"\n$t [$type] $msg").takeLast(12000)).apply()}
 companion object { fun readLog(c:Context)=c.getSharedPreferences("gps_test",Context.MODE_PRIVATE).getString("log","No GPS events yet")?:"No GPS events yet" }
}
