import { createClient } from "npm:@supabase/supabase-js@2";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
const rad=(v:number)=>(v*Math.PI)/180;
function meters(a:number,b:number,c:number,d:number){const x=rad(c-a),y=rad(d-b),h=Math.sin(x/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(y/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return reply(500,{error:"server_not_configured"});
  const auth=req.headers.get("authorization")??"";if(!auth.startsWith("Bearer "))return reply(401,{error:"unauthorized"});
  const token=auth.slice(7),userClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:userData,error:userError}=await userClient.auth.getUser(token);if(userError||!userData.user)return reply(401,{error:"invalid_session"});
  const uid=userData.user.id,db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:roles,error:roleError}=await db.from("user_roles").select("role").eq("user_id",uid);
  if(roleError)return reply(500,{error:"role_check_failed"});
  const names=(roles??[]).map((r:{role:string})=>r.role);if(!names.includes("staff")||names.includes("owner")||names.includes("admin"))return reply(403,{error:"staff_only"});
  const body=await req.json(),lat=Number(body.latitude),lon=Number(body.longitude),acc=Number(body.accuracyMeters),ts=Number(body.capturedAt);
  if(!Number.isFinite(lat)||lat< -90||lat>90||!Number.isFinite(lon)||lon< -180||lon>180||!Number.isFinite(acc)||acc<0||acc>50||!Number.isSafeInteger(ts)||ts<=0)return reply(400,{error:"invalid_gps_reading"});
  const now=Date.now();if(ts>now+30000||now-ts>120000)return reply(400,{error:"stale_gps_reading"});
  const {data:settings,error:se}=await db.from("attendance_settings").select("geofence_enabled").eq("id",true).maybeSingle();
  if(se)return reply(500,{error:"settings_check_failed"});if(!settings?.geofence_enabled)return reply(200,{recorded:false,reason:"geofence_disabled"});
  const {data:session,error:xe}=await db.from("attendance_sessions").select("id,shift_id").eq("user_id",uid).is("clock_out_at",null).order("clock_in_at",{ascending:false}).limit(1).maybeSingle();
  if(xe)return reply(500,{error:"active_duty_check_failed"});if(!session?.shift_id)return reply(200,{recorded:false,reason:"no_active_shift"});
  const {data:shift,error:she}=await db.from("attendance_shifts").select("station_id").eq("id",session.shift_id).eq("user_id",uid).maybeSingle();
  if(she)return reply(500,{error:"shift_check_failed"});if(!shift?.station_id)return reply(200,{recorded:false,reason:"no_station_shift"});
  const {data:station,error:ste}=await db.from("attendance_stations").select("id,latitude,longitude,geofence_radius_meters,is_active").eq("id",shift.station_id).maybeSingle();
  if(ste)return reply(500,{error:"station_check_failed"});if(!station?.is_active||station.latitude==null||station.longitude==null)return reply(200,{recorded:false,reason:"station_unconfigured"});
  const distance=meters(lat,lon,Number(station.latitude),Number(station.longitude)),inside=distance<=Number(station.geofence_radius_meters);
  const {data:prev,error:pe}=await db.from("attendance_location_events").select("event_type").eq("session_id",session.id).order("occurred_at",{ascending:false}).limit(1).maybeSingle();
  if(pe)return reply(500,{error:"previous_event_check_failed"});
  let eventType:"geofence_enter"|"geofence_exit"|"reentry"|null=null;
  if(!prev)eventType=inside?"geofence_enter":null;else if(inside&&prev.event_type==="geofence_exit")eventType="reentry";else if(!inside&&prev.event_type!=="geofence_exit")eventType="geofence_exit";
  if(!eventType)return reply(200,{recorded:false,reason:"no_transition",inside});
  const {error:ie}=await db.from("attendance_location_events").insert({user_id:uid,session_id:session.id,station_id:station.id,event_type:eventType,occurred_at:new Date(ts).toISOString(),distance_from_site_m:Math.round(distance*100)/100,accuracy_m:Math.round(acc*100)/100});
  if(ie){console.error("GPS event insert failed",ie.message);return reply(500,{error:"event_save_failed"});}
  return reply(200,{recorded:true,eventType,inside,distanceMeters:Math.round(distance)});
 }catch(e){console.error("attendance-gps-transition failed",e);return reply(400,{error:"invalid_request"});}
});