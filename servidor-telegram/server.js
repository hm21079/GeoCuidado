"use strict";
// GeoCuidado: servidor local de alertas Telegram, sin Cloud Functions.
// Node.js 20+, sin dependencias externas. Solo LECTURA de Firebase.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ROOT = __dirname;
function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) throw Error("Falta servidor-telegram/.env: copia .env.example y complétalo.");
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
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatIds: (process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "")
    .split(",").map(x => x.trim()).filter(Boolean),
  enabled: process.env.ENABLE_TELEGRAM === "true",
  interval: Math.max(10, Number(process.env.POLL_SECONDS) || 15) * 1000
};
const missing = ["apiKey","databaseURL","email","password","telegramToken"].filter(k => !cfg[k] || /^(PEGA_|CORREO_|CONTRASENA_|TOKEN_|ID_)/.test(cfg[k]));
if (missing.length) {console.error("Configura .env: faltan", missing.join(", ")); process.exit(1);}
const stateFile = path.join(ROOT, ".estado-local.json");
let state = {version:1, initialized:false, lastPosition:null, lastOutside:null, knownAvisos:[], knownNotificaciones:[], telegramOffset:0, vinculados:{}, sent:{}};
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
function recipients(people) {
  const found = new Set(cfg.telegramChatIds);
  for (const [id, r] of Object.entries(people || {})) {
    if (r && r.telegramCodigo && state.vinculados?.[id]?.codigo === r.telegramCodigo) {
      found.add(String(state.vinculados[id].chatId));
    }
  }
  return [...found].filter(id => /^-?\d+$/.test(id));
}
// El bot recibe /start CODIGO y vincula ese chat al registro correcto de Firebase.
// El vínculo se almacena localmente, sin exponer credenciales Firebase de escritura.
async function procesarVinculos(people) {
  const response = await jsonFetch(`https://api.telegram.org/bot${cfg.telegramToken}/getUpdates?offset=${Number(state.telegramOffset||0)}&timeout=0`);
  for (const update of response.result || []) {
    state.telegramOffset = Math.max(Number(state.telegramOffset||0), Number(update.update_id)+1);
    const msg = update.message;
    const match = String(msg?.text || "").trim().match(/^\/start(?:@\w+)?\s+(gc_[a-f0-9]{36})$/i);
    if (!match || msg.chat?.type !== "private") continue;
    const entry = Object.entries(people || {}).find(([,r]) => r?.telegramCodigo === match[1]);
    if (!entry) { await send(String(msg.chat.id),"Este enlace de GeoCuidado no está vigente. Solicita uno nuevo."); continue; }
    const [id,r] = entry;
    // Un código corresponde a un único chat; un chat puede tener varios responsables.
    state.vinculados[id] = {codigo:match[1],chatId:String(msg.chat.id),fecha:new Date().toISOString()};
    saveState();
    await send(String(msg.chat.id),`✅ Telegram vinculado con GeoCuidado. Responsable: ${clean(r.nombre)}. Recibirás alertas y recordatorios programados.`);
    log("Responsable vinculado a Telegram:",id);
  }
  saveState();
}
function clean(s, limit=600) {
  return String(s ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, limit) || "Sin información";
}
function alertText(values) {
  return `🚨 ALERTA GEOCUIDADO\n\nTipo de alerta: ${clean(values[0])}\n\nDescripción: ${clean(values[1], 1200)}\n\nRevise la situación de la persona monitoreada.`;
}
function careText(values) {
  return `💊 RECORDATORIO GEOCUIDADO\n\nTipo de cuidado: ${clean(values[0])}\nActividad: ${clean(values[1])}\nIndicaciones: ${clean(values[2], 1200)}\nHora programada: ${clean(values[3])}\n\nVerifique la actividad programada.`;
}
async function send(to, text) {
  const result = await jsonFetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({chat_id: to, text, disable_web_page_preview: true})
  });
  if (!result.ok) throw Error(result.description || "Telegram no aceptó el mensaje");
  return result.result?.message_id || "aceptado";
}
async function notify(id, kind, values, people) {
  const chats = recipients(people);
  if (!chats.length) {log("No hay TELEGRAM_CHAT_ID configurado ni responsables Telegram autorizados.");return;}
  const message = kind === "care" ? careText(values) : alertText(values);
  for (const to of chats) {
    const key = crypto.createHash("sha256").update(id+":"+to).digest("hex");
    if (state.sent[key]) continue;
    if (!cfg.enabled) {log("SIMULACIÓN", id, "chat ****"+to.slice(-4));continue;}
    // Estado pendiente antes del envío: evita duplicados en caso de reinicio.
    state.sent[key] = {status:"pendiente",at:Date.now(),event:id};saveState();
    try {
      const messageId = await send(to,message);
      state.sent[key] = {status:"enviado",messageId,at:Date.now(),event:id};saveState();
      log("Telegram aceptó",id,"chat ****"+to.slice(-4));
    } catch(e) {
      state.sent[key] = {status:"error_revisar",error:clean(e.message,250),at:Date.now(),event:id};saveState();
      console.error("Error enviando",id,e.message.replace(cfg.telegramToken,"[TOKEN_OCULTO]"));
    }
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
  const notificaciones=data.notificaciones||{};
  await procesarVinculos(people);
  const keys=Object.keys(avisos);
  const timestamp=Number(data.timestamp)||0;
  const validCoords = data.latitud != null && data.longitud != null &&
    Number.isFinite(Number(data.latitud)) && Number.isFinite(Number(data.longitud)) &&
    Math.abs(Number(data.latitud)) <= 90 && Math.abs(Number(data.longitud)) <= 180;
  const positionKey = validCoords ? `${Number(data.latitud).toFixed(6)},${Number(data.longitud).toFixed(6)}` : null;
  const currentPosition = timestamp ? `ts:${timestamp}` : (positionKey ? `xy:${positionKey}` : null);
  if(!state.initialized){
    state.knownAvisos=keys;
    state.knownNotificaciones=Object.keys(notificaciones);
    state.lastPosition=currentPosition;
    state.initialized=true;
    const lat=Number(data.latitud),lng=Number(data.longitud),z=data.zona||{};
    if(z.activa!==false&&Number.isFinite(lat)&&Number.isFinite(lng)&&Number.isFinite(Number(z.latitud))&&Number.isFinite(Number(z.longitud))&&Number(z.radio)>=10)
      state.lastOutside=distance(lat,lng,Number(z.latitud),Number(z.longitud))>Number(z.radio);
    saveState();log("Monitor iniciado. Eventos existentes ignorados para evitar envíos antiguos.");
    return;
  }
  // FUENTE PRINCIPAL: cada registro nuevo del Centro de notificaciones
  // se entrega por Telegram sin filtrar por tipo, categoría ni estado leída.
  // Una misma notificación conserva el mismo ID y se deduplica por destinatario.
  const knownN = new Set(state.knownNotificaciones || []);
  const newNotifications = Object.entries(notificaciones).filter(([id,n]) =>
    !knownN.has(id) && n && typeof n === "object" && (n.mensaje || n.titulo)
  );
  for (const [id,n] of newNotifications) {
    await notify("notificacion:"+id,"alert",[
      n.titulo || n.tipo || "Notificación de GeoCuidado",
      n.mensaje || "Sin descripción"
    ],people);
  }
  // Conservar IDs existentes para no reenviar al reiniciar. No recortar la
  // lista a 1000: registros antiguos podrían volver a parecer nuevos.
  state.knownNotificaciones = Object.keys(notificaciones);
  state.knownAvisos = keys;
  // Evitar una segunda entrega de los mismos eventos desde /avisos.
  // El Centro de notificaciones es la fuente única para avisos de la web.
  const hayEventoSeguridadNuevo = newNotifications.some(([,n]) =>
    /per[ií]metro|zona segura|seguridad|regreso/i.test(
      [n.tipo,n.titulo,n.mensaje].filter(Boolean).join(" ")
    )
  );
  const lat=Number(data.latitud),lng=Number(data.longitud),z=data.zona||{};
  if(currentPosition && currentPosition!==state.lastPosition){
    state.lastPosition=currentPosition;
    if(z.activa!==false && data.latitud!=null && data.longitud!=null && z.latitud!=null && z.longitud!=null && Number(z.radio)>=10 && Number.isFinite(lat)&&Number.isFinite(lng)){
      const outside=distance(lat,lng,Number(z.latitud),Number(z.longitud))>Number(z.radio);
      if(state.lastOutside!==null&&outside!==state.lastOutside && !hayEventoSeguridadNuevo){
        const type=outside?"Salida de perímetro":"Regreso a zona segura";
        const message=`${type}. Ubicación: https://www.google.com/maps?q=${lat},${lng}`;
        await notify("gps:"+currentPosition+":"+outside,"alert",[type,message],people);
      }
      state.lastOutside=outside;
    }
  }
  const {day,hour}=localParts();
  for(const [id,c] of Object.entries(data.cuidados||{})){
    if(c&&c.nombre&&c.hora===hour&&occurs(c,day))
      await notify(`cuidado:${id}:${day}:${hour}`,"care",[c.tipo||"Cuidado",c.nombre,c.detalle||"Sin indicaciones",hour],people);
  }
  // Mantener registro acotado; conserva 60 días de deduplicación.
  const cutoff=Date.now()-60*86400000;
  for(const [k,v] of Object.entries(state.sent))if(v.at<cutoff)delete state.sent[k];
  saveState();
}
async function main(){
  if(process.argv.includes("--test")) {
    const chats=recipients({});
    if(!chats.length) throw Error("Configura TELEGRAM_CHAT_ID con el Chat ID de tu conversación.");
    for(const to of chats){
      const messageId=await send(to,"✅ GeoCuidado: prueba de Telegram exitosa. El bot ya puede enviar notificaciones.");
      log("Prueba enviada correctamente. ID del mensaje:",messageId);
    }
    return;
  }
  log("GeoCuidado Telegram local",cfg.enabled?"ENVÍO ACTIVADO":"MODO SIMULACIÓN",`cada ${cfg.interval/1000}s`);
  if(!cfg.enabled) log("Los eventos no se enviarán. Para activar: ENABLE_TELEGRAM=true en .env");
  while(true){
    try{await tick();}catch(e){console.error("Error de monitoreo:",e.message.replace(cfg.telegramToken,"[TOKEN_OCULTO]"));}
    await new Promise(resolve=>setTimeout(resolve,cfg.interval));
  }
}
main().catch(e=>{console.error(e.message.replace(cfg.telegramToken||"__SIN_TOKEN__","[TOKEN_OCULTO]"));process.exitCode=1;});
