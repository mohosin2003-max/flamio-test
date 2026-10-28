package bd.flamio.attendancegpstest
import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
object SupabaseGpsClient {
 private const val PREFS="gps_test"
 private fun p(c:Context)=c.getSharedPreferences(PREFS,Context.MODE_PRIVATE)
 private fun root(s:String)=s.trim().trimEnd('/')
 fun signIn(c:Context,url:String,key:String,email:String,password:String):String {
  val base=root(url);require(base.startsWith("https://")){"Use HTTPS for TEST Supabase."}
  require(key.startsWith("sb_publishable_")||key.count{it=='.'}==2){"Enter the TEST project's publishable/anon key."}
  val r=request("$base/auth/v1/token?grant_type=password",key,null,JSONObject().put("email",email.trim()).put("password",password))
  save(c,r);p(c).edit().putString("supabase_url",base).putString("api_key",key).apply()
  return r.optJSONObject("user")?.optString("email").takeUnless{it.isNullOrBlank()}?:email
 }
 fun send(c:Context,lat:Double,lon:Double,accuracy:Float,time:Long):String {
  val pref=p(c);val base=root(pref.getString("supabase_url","")?:"");val key=pref.getString("api_key","")?:""
  var access=pref.getString("access_token","")?:"";val refresh=pref.getString("refresh_token","")?:""
  if(base.isBlank()||key.isBlank()||access.isBlank()||refresh.isBlank())throw IllegalStateException("Sign in with TEST Staff account first.")
  if(pref.getLong("expires_at",0L)<=System.currentTimeMillis()/1000+120){val r=request("$base/auth/v1/token?grant_type=refresh_token",key,null,JSONObject().put("refresh_token",refresh));save(c,r);access=r.getString("access_token")}
  val body=JSONObject().put("latitude",lat).put("longitude",lon).put("accuracyMeters",accuracy.toDouble()).put("capturedAt",time)
  return request("$base/functions/v1/attendance-gps-transition",key,access,body).toString()
 }
 private fun save(c:Context,r:JSONObject){val a=r.optString("access_token");val b=r.optString("refresh_token");if(a.isBlank()||b.isBlank())throw IllegalStateException("No valid TEST session returned.")
  p(c).edit().putString("access_token",a).putString("refresh_token",b).putLong("expires_at",System.currentTimeMillis()/1000+r.optLong("expires_in",3600)).putString("user_email",r.optJSONObject("user")?.optString("email")?:"").apply()}
 private fun request(url:String,key:String,bearer:String?,body:JSONObject):JSONObject {
  val c=(URL(url).openConnection() as HttpURLConnection).apply{requestMethod="POST";connectTimeout=15000;readTimeout=20000;doOutput=true;setRequestProperty("apikey",key);setRequestProperty("Content-Type","application/json");setRequestProperty("Accept","application/json");if(!bearer.isNullOrBlank())setRequestProperty("Authorization","Bearer $bearer")}
  try{OutputStreamWriter(c.outputStream,Charsets.UTF_8).use{it.write(body.toString())};val status=c.responseCode;val stream=if(status in 200..299)c.inputStream else c.errorStream;val text=BufferedReader(InputStreamReader(stream,Charsets.UTF_8)).use{it.readText()}
   if(status !in 200..299){val msg=try{val j=JSONObject(text);j.optString("msg").ifBlank{j.optString("message")}.ifBlank{j.optString("error_description")}.ifBlank{j.optString("error")}}catch(_:Exception){"Request failed"};throw IllegalStateException("HTTP $status: $msg")}
   return JSONObject(text)
  }finally{c.disconnect()}
 }
}