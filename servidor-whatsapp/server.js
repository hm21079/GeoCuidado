"use strict";
// GeoCuidado: servidor local de WhatsApp Cloud API, sin Cloud Functions.
// Node.js 20+, sin dependencias externas. Solo LECTURA de Firebase.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ROOT = __dirname;
function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) throw Error("Falta servidor-whatsapp/.env: copia .env.example y complétalo.");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
loadEnv();
const cfg = {
  apiKey: process.env.FIREBASE_API_KEY,
  databaseURL: (process.env.FIREBASE_DATABASE_URL || "").replace(/\/$/, ""),
  email: process.env.FIREBASE_EMAIL,
  password: process.env.FIREBASE_PASSWORD,
  device: process.env.DEVICE_ID || "gps001",
  token: process.env.WA_ACCESS_TOKEN,
  phoneId: process.env.WA_PHONE_NUMBER_ID,
  graph: process.env.WA_GRAPH_VERSION || "v25.0",
  alertTemplate: process.env.WA_ALERT_TEMPLATE || "geocuidado_alerta",
  careTemplate: process.env.WA_CARE_TEMPLATE || "geocuidado_cuidado",
  lang: process.env.WA_TEMPLATE_LANG || "es",
  enabled: process.env.ENABLE_WHATSAPP === "true",
  interval: Math.max(10, Number(process.env.POLL_SECONDS) || 15) * 1000
};
const missing = ["apiKey","databaseURL","email","password","token","phoneId"].filter(k => !cfg[k] || /^(PEGA_|CORREO_|CONTRASENA_|TOKEN_|ID_)/.test(cfg[k]));
if (missing.length) {console.error("Configura .env: faltan", missing.join(", ")); process.exit(1);}
const stateFile = path.join(ROOT, ".estado-local.json");
let state = {version:1, initialized:false, lastPosition:null, lastOutside:null, knownAvisos:[], sent:{}};
try { state = {...state, ...JSON.parse(fs.readFileSync(stateFile, "utf8"))}; } catch {}
function saveState() {
  const tmp = stateFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state,null,2), {mode:0o600});
  fs.renameSync(tmp,stateFile);
}
const log = (...a) => console.log(new Date().toLocaleString("es-SV",{timeZone:"America/El_Salvador"}),...a);
let auth = {token:null, expires:0};
async function jsonFetch(url, options={}) {
  const r=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw Error(`HTTP ${r.status}: ${JSON.stringify(data.error || data).slice(0,280)}`);
  return data;
}
async function firebaseToken() {
  if (auth.token && Date.now()<auth.expires-120000) return auth.token;
  const data=await jsonFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(cfg.apiKey)}`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:cfg.email,password:cfg.password,returnSecureToken:true})
  });
  auth={token:data.idToken,expires:Date.now()+Number(data.expiresIn||3600)*1000};
  return auth.token;
}
async function readDB(subpath="") {
  const token=await firebaseToken();
  const url=`${cfg.databaseURL}/dispositivos/${encodeURIComponent(cfg.device)}${subpath ? "/"+subpath : ""}.json?auth=${encodeURIComponent(token)}`;
  try {return await jsonFetch(url);} catch(e){if(/HTTP 401|HTTP 403/.test(e.message))auth.token=null;throw e;}
}
function phone(n) {
  let p=String(n||"").replace(/\D/g,"");
  if(p.length===8)p="503"+p;
  return /^503\d{8}$/.test(p)?p:null;
}
function recipients(people) {
  const found=new Set();
  for(const r of Object.values(people||{})) {
    if(r && r.whatsappAutorizado===true) {const p=phone(r.telefono);if(p)found.add(p);}
  }
  return [...found];
}
function clean(s,limit=500){return String(s??"").replace(/[\r\n\t]+/g," ").trim().slice(0,limit)||"Sin información";}
async function send(to, template, values=[]) {
  const payload={messaging_product:"whatsapp",to,type:"template",template:{name:template,language:{code:cfg.lang}}};
  if(values.length)payload.template.components=[{type:"body",parameters:values.map(v=>({type:"text",text:clean(v)}))}];
  const result=await jsonFetch(`https://graph.facebook.com/${cfg.graph}/${encodeURIComponent(cfg.phoneId)}/messages`,{
    method:"POST",headers:{Authorization:`Bearer ${cfg.token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)
  });
  return result.messages?.[0]?.id || "aceptado";
}
async function notify(id,template,values,people) {
  const phones=recipients(people);
  if(!phones.length){log("No hay responsables con WhatsApp autorizado y número válido.");return;}
  for(const to of phones){
    const key=crypto.createHash("sha256").update(id+":"+to).digest("hex");
    if(state.sent[key])continue;
    if(!cfg.enabled){log("SIMULACIÓN",id,"destino ****"+to.slice(-4),"plantilla",template);continue;}
    // Marcar ANTES del envío evita duplicados tras reinicio; si falla, requiere revisión manual.
    state.sent[key]={status:"pendiente",at:Date.now(),event:id};saveState();
    try {const messageId=await send(to,template,values);state.sent[key]={status:"aceptado_por_meta",messageId,at:Date.now(),event:id};saveState();log("Meta aceptó",id,"destino ****"+to.slice(-4));}
    catch(e){state.sent[key]={status:"error_revisar",error:clean(e.message,250),at:Date.now(),event:id};saveState();console.error("Error enviando",id,e.message);}
  }
}
function distance(a,b,c,d){const r=x=>x*Math.PI/180;const x=r(c-a),y=r(d-b),h=Math.sin(x/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(y/2)**2;return 12742000*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
function localParts(now=new Date()) {
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/El_Salvador",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const v=k=>parts.find(x=>x.type===k).value;
  return {day:`${v("year")}-${v("month")}-${v("day")}`,hour:`${v("hour")}:${v("minute")}`};
}
function dateUTC(s){const [y,m,d]=s.split("-").map(Number);return Date.UTC(y,m-1,d);}
function occurs(c,day){
  if(!c.fecha)return true;
  if(day<c.fecha || (c.fechaFin&&day>c.fechaFin))return false;
  const rep=c.repeticion||"unica",dow=new Date(dateUTC(day)).getUTCDay(),days=(c.diasSemana||[]).map(Number),monthday=Number(day.slice(8));
  const diff=Math.round((dateUTC(day)-dateUTC(c.fecha))/86400000),n=Math.max(1,Number(c.intervalo)||1);
  if(rep==="unica")return day===c.fecha;
  if(rep==="diaria")return true;
  if(rep==="semanal")return days.includes(dow);
  if(rep==="mensual")return (c.diasMes||[]).map(Number).includes(monthday);
  if(rep==="personalizado-dias")return diff%n===0;
  if(rep==="personalizado-semanas")return Math.floor(diff/7)%n===0&&days.includes(dow);
  if(rep==="personalizado-meses"){
    const [y,m,d]=c.fecha.split("-").map(Number),[Y,M,D]=day.split("-").map(Number);
    return ((Y-y)*12+M-m)%n===0&&D===d;
  }
  return false;
}
async function tick() {
  const data=await readDB();
  if(!data||typeof data!=="object")return;
  const people=data.responsables||{};
  const avisos=data.avisos||{};
  const keys=Object.keys(avisos);
  const timestamp=Number(data.timestamp)||0;
  if(!state.initialized){
    state.knownAvisos=keys.slice(-500);
    state.lastPosition=timestamp||null;
    state.initialized=true;
    const lat=Number(data.latitud),lng=Number(data.longitud),z=data.zona||{};
    if(z.activa!==false&&Number.isFinite(lat)&&Number.isFinite(lng)&&Number.isFinite(Number(z.latitud))&&Number.isFinite(Number(z.longitud))&&Number(z.radio)>=10)
      state.lastOutside=distance(lat,lng,Number(z.latitud),Number(z.longitud))>Number(z.radio);
    saveState();log("Monitor iniciado. Eventos existentes ignorados para evitar envíos antiguos.");
    return;
  }
  const seen=new Set(state.knownAvisos||[]);
  for(const id of keys){
    if(seen.has(id))continue;
    const a=avisos[id]||{};
    // Las salidas y regresos los detecta el servidor; no reenviar avisos del navegador.
    if(a.tipo && a.mensaje && !["perimetro","regreso","Salida de perímetro","Regreso a zona segura"].includes(a.tipo))
      await notify("aviso:"+id,cfg.alertTemplate,[a.tipo,a.mensaje],people);
  }
  state.knownAvisos=keys.slice(-500);
  const lat=Number(data.latitud),lng=Number(data.longitud),z=data.zona||{};
  if(timestamp&&timestamp!==state.lastPosition){
    state.lastPosition=timestamp;
    if(z.activa!==false && data.latitud!=null && data.longitud!=null && z.latitud!=null && z.longitud!=null && Number(z.radio)>=10 && Number.isFinite(lat)&&Number.isFinite(lng)){
      const outside=distance(lat,lng,Number(z.latitud),Number(z.longitud))>Number(z.radio);
      if(state.lastOutside!==null&&outside!==state.lastOutside){
        const type=outside?"Salida de perímetro":"Regreso a zona segura";
        const message=`${type}. Ubicación: https://www.google.com/maps?q=${lat},${lng}`;
        await notify("gps:"+timestamp+":"+outside,cfg.alertTemplate,[type,message],people);
      }
      state.lastOutside=outside;
    }
  }
  const {day,hour}=localParts();
  for(const [id,c] of Object.entries(data.cuidados||{})){
    if(c&&c.nombre&&c.hora===hour&&occurs(c,day))
      await notify(`cuidado:${id}:${day}:${hour}`,cfg.careTemplate,[c.tipo||"Cuidado",c.nombre,c.detalle||"Sin indicaciones",hour],people);
  }
  // Mantener registro acotado; conserva 60 días de deduplicación.
  const cutoff=Date.now()-60*86400000;
  for(const [k,v] of Object.entries(state.sent))if(v.at<cutoff)delete state.sent[k];
  saveState();
}
async function main(){
  if(process.argv.includes("--test")){
    const to=phone(process.env.WA_TEST_TO);
    if(!to)throw Error("Configura WA_TEST_TO con tu número aprobado de prueba, formato 503XXXXXXXX.");
    const messageId=await send(to,"hello_world",[]);
    log("Meta aceptó la prueba hello_world. ID:",messageId);
    return;
  }
  log("GeoCuidado WhatsApp local",cfg.enabled?"ENVÍO ACTIVADO":"MODO SIMULACIÓN",`cada ${cfg.interval/1000}s`);
  if(!cfg.enabled)log("No se enviarán WhatsApp. Cambia ENABLE_WHATSAPP=true cuando tengas plantillas aprobadas.");
  while(true){try{await tick();}catch(e){console.error("Error de monitoreo:",e.message);}await new Promise(resolve=>setTimeout(resolve,cfg.interval));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
