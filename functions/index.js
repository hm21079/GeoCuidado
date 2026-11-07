"use strict";
const {onValueCreated, onValueWritten} = require("firebase-functions/v2/database");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
admin.initializeApp();

const REGION = "us-central1";
const DEVICE = "gps001";
const ROOT = `dispositivos/${DEVICE}`;
const WA_TOKEN = defineSecret("WA_TOKEN");
const WA_PHONE_ID = defineSecret("WA_PHONE_ID");
const WA_TEMPLATE_ALERTA = "geocuidado_alerta";
const WA_TEMPLATE_CUIDADO = "geocuidado_cuidado";
const WA_LANG = "es";

function normalizePhone(value) {
  let n = String(value || "").replace(/\D/g, "");
  if (n.length === 8) n = "503" + n;
  return /^503\d{8}$/.test(n) ? n : null;
}
function cleanText(value, max=300) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0,max) || "Sin información";
}
async function recipients() {
  const snap = await admin.database().ref(`${ROOT}/responsables`).get();
  const unique = new Set();
  for (const person of Object.values(snap.val() || {})) {
    if (person.whatsappAutorizado !== true) continue;
    const phone = normalizePhone(person.telefono);
    if (phone) unique.add(phone);
  }
  return [...unique];
}
async function sendTemplate(to, template, parameters) {
  const response = await fetch(`https://graph.facebook.com/v25.0/${WA_PHONE_ID.value()}/messages`, {
    method: "POST",
    headers: {Authorization: `Bearer ${WA_TOKEN.value()}`, "Content-Type": "application/json"},
    body: JSON.stringify({messaging_product: "whatsapp", to, type: "template",
      template: {name: template, language: {code: WA_LANG}, components: [
        {type: "body", parameters: parameters.map(text => ({type: "text", text: cleanText(text, 500)}))}
      ]}})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Meta HTTP ${response.status}: ${JSON.stringify(payload).slice(0,350)}`);
  return payload.messages?.[0]?.id || "accepted";
}
async function dispatch(eventId, template, params) {
  const phones = await recipients();
  if (!phones.length) {logger.warn("Sin responsables con consentimiento y teléfono válido"); return;}
  for (const phone of phones) {
    const key = `${eventId}_${phone}`.replace(/[^a-zA-Z0-9_-]/g,"_");
    const ref = admin.database().ref(`${ROOT}/enviosWhatsApp/${key}`);
    const lock = await ref.transaction(old => old === null ? {estado:"procesando", inicio:Date.now()} : undefined);
    if (!lock.committed) continue;
    try {
      const messageId = await sendTemplate(phone, template, params);
      await ref.update({estado:"aceptado_por_meta", messageId, fin:Date.now()});
    } catch (error) {
      await ref.update({estado:"error", error:cleanText(error.message,300), fin:Date.now()});
      logger.error("Error de WhatsApp", {eventId, phoneSuffix:phone.slice(-4), error:error.message});
    }
  }
}
exports.enviarAvisoWhatsApp = onValueCreated({
  ref: `${ROOT}/avisos/{avisoId}`, region: REGION,
  secrets: [WA_TOKEN, WA_PHONE_ID]
}, async event => {
  const aviso = event.data.val();
  if (!aviso || !aviso.tipo || !aviso.mensaje) return;
  await dispatch(`aviso_${event.params.avisoId}`, WA_TEMPLATE_ALERTA,
    [aviso.tipo, aviso.mensaje]);
});

// Se ejecuta cada minuto en zona horaria de El Salvador, aunque el navegador esté cerrado.
// Para la programación básica del ZIP original, cada cuidado tiene 'hora' HH:mm.
exports.recordatoriosWhatsApp = onSchedule({
  schedule: "every 1 minutes", timeZone: "America/El_Salvador",
  region: REGION, secrets: [WA_TOKEN, WA_PHONE_ID]
}, async () => {
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-CA", {timeZone:"America/El_Salvador",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const get = type => local.find(x => x.type === type)?.value;
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = `${get("hour")}:${get("minute")}`;
  const snap = await admin.database().ref(`${ROOT}/cuidados`).get();
  for (const [id, care] of Object.entries(snap.val() || {})) {
    if (!care || care.hora !== hour || !care.nombre) continue;
    if (!coincideFecha(care, day)) continue;
    await dispatch(`cuidado_${id}_${day}_${hour.replace(":", "")}`, WA_TEMPLATE_CUIDADO,
      [care.tipo || "Cuidado", care.nombre, care.detalle || "Sin indicaciones adicionales", hour]);
  }
});

// Reproduce las mismas reglas de recurrencia que js/cuidados.js.
function dateUTC(s) { const [y,m,d]=s.split("-").map(Number); return Date.UTC(y,m-1,d); }
function daysBetween(a,b) {return Math.round((dateUTC(b)-dateUTC(a))/86400000);}
function monday(s) {const t=dateUTC(s);return new Date(t-((new Date(t).getUTCDay()+6)%7)*86400000).toISOString().slice(0,10);}
function coincideFecha(c,hoy) {
  if (!c.fecha) return true;
  if (hoy<c.fecha || (c.fechaFin && hoy>c.fechaFin)) return false;
  const r=c.repeticion||"unica";
  if(r==="unica")return hoy===c.fecha;
  if(r==="diaria")return true;
  const dia=new Date(dateUTC(hoy)).getUTCDay();
  if(r==="semanal")return (c.diasSemana||[]).map(Number).includes(dia);
  if(r==="mensual")return (c.diasMes||[]).map(Number).includes(Number(hoy.slice(8)));
  const n=Math.max(1,Number(c.intervalo)||1);
  if(r==="personalizado-dias")return daysBetween(c.fecha,hoy)%n===0;
  if(r==="personalizado-semanas")return daysBetween(monday(c.fecha),monday(hoy))/7%n===0&&(c.diasSemana||[]).map(Number).includes(dia);
  if(r==="personalizado-meses"){
    const [ya,ma,da]=c.fecha.split("-").map(Number),[yb,mb,db]=hoy.split("-").map(Number);
    return ((yb-ya)*12+mb-ma)%n===0&&db===da;
  }
  return false;
}
function meters(a,b,c,d) {
  const rad=x=>x*Math.PI/180, R=6371000;
  const x=rad(c-a),y=rad(d-b);
  const h=Math.sin(x/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(y/2)**2;
  return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
// El ESP32 escribe timestamp al publicar coordenadas. Este detector funciona sin navegador.
exports.detectarPerimetro = onValueWritten({
  ref:`${ROOT}/timestamp`, region:REGION
}, async event=>{
  if (!event.data.after.exists()) return;
  const root=admin.database().ref(ROOT);
  const snap=await root.get(), d=snap.val()||{}, z=d.zona||{};
  const lat=Number(d.latitud),lng=Number(d.longitud),clat=Number(z.latitud),clng=Number(z.longitud),radio=Number(z.radio);
  if([lat,lng,clat,clng,radio].some(x=>!Number.isFinite(x))||
     Math.abs(lat)>90||Math.abs(clat)>90||Math.abs(lng)>180||Math.abs(clng)>180||radio<10) return;
  const fuera=meters(lat,lng,clat,clng)>radio;
  const stateRef=root.child("monitoreoServidor/perimetro");
  const previo=(await stateRef.get()).val();
  const tx=await stateRef.transaction(old=>{
    if(old && old.fuera===fuera)return;
    return {fuera,fecha:Date.now(),lat,lng};
  });
  if(!tx.committed)return;
  // No alertar por un estado inicial dentro de la zona.
  if(!fuera && !previo)return;
  const tipo=fuera?"Salida de perímetro":"Regreso a zona segura";
  const mensaje=`${fuera?"El dispositivo salió del perímetro de seguridad.":"El dispositivo regresó a la zona segura."} Ubicación: ${lat.toFixed(6)}, ${lng.toFixed(6)}. https://www.google.com/maps?q=${lat},${lng}`;
  await root.child("avisos").push({tipo,mensaje,fecha:new Date().toISOString(),origen:"servidor",estado:"Registrado en GeoCuidado"});
});
