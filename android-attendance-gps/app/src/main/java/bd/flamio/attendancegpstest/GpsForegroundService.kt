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
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import org.json.JSONObject
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Foreground location service. Every accurate fix goes into a persistent queue
 * first, then the queue is flushed oldest-first, so readings taken offline are
 * sent (in order) once the connection returns — including after a restart.
 */
class GpsForegroundService:Service(),LocationListener{
 private lateinit var lm:LocationManager
 private val channel="flamio_gps_test"
 // Single thread: queue reads/writes and network sends never overlap.
 private val worker:ScheduledExecutorService=Executors.newSingleThreadScheduledExecutor()
 private var lastQueuedAt=0L
 private var networkCallback:ConnectivityManager.NetworkCallback?=null
 private val queue by lazy{queueFor(this)}

 override fun onCreate(){
  super.onCreate()
  if(Build.VERSION.SDK_INT>=26)(getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel(channel,"Flamio Attendance GPS",NotificationManager.IMPORTANCE_LOW))
  startForeground(1001,notification("Connecting to TEST Attendance"))
  lm=getSystemService(Context.LOCATION_SERVICE) as LocationManager
  if(!SupabaseGpsClient.isSignedIn(this)){add("AUTH_REQUIRED","Sign in with TEST Staff account first");stopSelf();return}
  try{
   lm.requestLocationUpdates(LocationManager.GPS_PROVIDER,10000L,5f,this,mainLooper)
   add("SERVICE_STARTED","Foreground GPS active; pending readings: ${queue.pending().size}")
  }catch(e:SecurityException){add("PERMISSION_ERROR",e.message?:"Permission denied");stopSelf();return}
   catch(e:Exception){add("GPS_START_ERROR",e.message?:"Could not start GPS");stopSelf();return}
  registerConnectivity()
  // Restart recovery: anything left from before the restart is retried now.
  worker.execute{flush()}
  worker.scheduleWithFixedDelay({flush()},30,30,TimeUnit.SECONDS)
 }

 // Ask Android to recreate the service if it is killed while tracking.
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int=START_STICKY

 override fun onLocationChanged(location:Location){
  if(location.accuracy>50f){add("GPS_IGNORED","accuracy ${location.accuracy.toInt()}m exceeds 50m limit");return}
  if(location.time-lastQueuedAt<8000L)return
  lastQueuedAt=location.time
  worker.execute{
   val ok=queue.enqueue(QueuedFix(location.time,location.latitude,location.longitude,location.accuracy))
   if(!ok){
    if(queue.pending().size>=GpsQueue.MAX_PENDING)add("QUEUE_FULL","${GpsQueue.MAX_PENDING} readings waiting; newest reading not stored until the queue drains")
   }
   flush()
  }
 }

 private var lastStop:String?=null
 private fun flush(){
  val result=try{queue.flush{fix->sendOne(fix)}}catch(e:Exception){add("QUEUE_ERROR",e.message?:"queue error");return}
  val pending=queue.pending().size
  if(result.held>0)add("HELD","${result.held} reading(s) refused by server and kept in held log (total held ${queue.held().size})")
  val stop=result.stoppedBy
  if(stop!=null&&stop!=lastStop)add("QUEUE_PAUSED","$stop · $pending waiting")
  lastStop=stop
  val text=when{
   stop?.startsWith("auth:")==true->"Sign in again · $pending waiting"
   stop?.startsWith("forbidden:")==true->"Account not allowed · $pending waiting"
   pending>0->"Offline · $pending reading(s) waiting to send"
   else->"GPS active · all readings sent"
  }
  notify(text)
 }

 private fun sendOne(fix:QueuedFix):SendOutcome{
  return try{
   val j=JSONObject(SupabaseGpsClient.send(this,fix.latitude,fix.longitude,fix.accuracy,fix.capturedAt))
   val recorded=j.optBoolean("recorded",false)
   val event=j.optString("eventType",j.optString("reason","no_transition"))
   add(if(recorded)"EVENT_SAVED" else "NO_EVENT","$event @ ${time(fix.capturedAt)}")
   val stopReasons=setOf("attendance_disabled","geofence_disabled","no_active_shift","no_station_shift","station_unconfigured")
   if(!recorded&&event in stopReasons){
    // Server accepted the reading but Duty is not active: stop only when nothing else is waiting.
    if(queue.pending().size<=1){add("GPS_AUTO_STOP","Stopped tracking because Duty/geofence is not active: $event");stopSelf()}
   }
   SendOutcome.Confirmed
  }catch(e:GpsHttpException){classifyGpsReply(e.status,e.error)}
   catch(e:IOException){SendOutcome.Transient("network:"+(e.message?:"io"))}
   catch(e:Exception){SendOutcome.Transient("error:"+(e.message?:"unknown"))}
 }

 private fun registerConnectivity(){
  val cm=getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  val cb=object:ConnectivityManager.NetworkCallback(){override fun onAvailable(network:Network){worker.execute{queue.resetBackoff();flush()}}}
  try{cm.registerDefaultNetworkCallback(cb);networkCallback=cb}catch(e:Exception){add("NETWORK_WATCH_ERROR",e.message?:"")}
 }

 override fun onDestroy(){
  try{lm.removeUpdates(this)}catch(_:Exception){}
  networkCallback?.let{try{(getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it)}catch(_:Exception){}}
  worker.shutdown()
  add("SERVICE_STOPPED","GPS service stopped; ${queue.pending().size} reading(s) still saved and will send on next start")
  super.onDestroy()
 }
 override fun onBind(intent:Intent?):IBinder?=null
 override fun onProviderDisabled(provider:String){add("GPS_DISABLED",provider)}
 override fun onProviderEnabled(provider:String){add("GPS_ENABLED",provider)}
 @Deprecated("Deprecated API") override fun onStatusChanged(provider:String?,status:Int,extras:Bundle?){}
 private fun notify(s:String){(getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(1001,notification(s))}
 private fun notification(s:String):Notification{val b=if(Build.VERSION.SDK_INT>=26)Notification.Builder(this,channel)else Notification.Builder(this);return b.setContentTitle("Flamio Attendance GPS · TEST").setContentText(s).setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build()}
 private fun time(ms:Long)=SimpleDateFormat("HH:mm:ss",Locale.US).format(Date(ms))
 private fun add(type:String,msg:String){val p=getSharedPreferences("gps_test",Context.MODE_PRIVATE);val old=p.getString("log","")?:"";val t=SimpleDateFormat("HH:mm:ss",Locale.US).format(Date());p.edit().putString("log",(old+"\n$t [$type] $msg").takeLast(16000)).apply()}
 companion object{
  fun readLog(c:Context)=c.getSharedPreferences("gps_test",Context.MODE_PRIVATE).getString("log","No GPS events yet")?:"No GPS events yet"
  /** Queue persisted in its own private file; commit() so a crash right after cannot lose a write. */
  fun queueFor(c:Context):GpsQueue{
   val p=c.getSharedPreferences("gps_queue",Context.MODE_PRIVATE)
   return GpsQueue(object:QueueStore{
    override fun read(key:String)=p.getString(key,null)
    override fun write(key:String,value:String){p.edit().putString(key,value).commit()}
   })
  }
 }
}
