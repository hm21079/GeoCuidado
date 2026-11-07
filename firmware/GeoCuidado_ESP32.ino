/* GeoCuidado: ESP32 + NEO-6M + buzzer pasivo + Firebase.
   Librerías Arduino IDE: TinyGPSPlus, ArduinoJson (v7).
   GPS TX -> GPIO16 (RX2); GPS RX -> GPIO17 (TX2, opcional)
   GPS VCC -> 3V3 o 5V SEGÚN LA PLACA GPS; GND -> GND
   Buzzer pasivo pequeño + -> GPIO25, - -> GND.
   Para buzzer de alto consumo usa transistor y fuente apropiada.
*/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include <time.h>
#include "credenciales.h"

static const char* BASE="https://rastreadorgps-50c1d-default-rtdb.firebaseio.com";
static const int PIN_RX_GPS=16, PIN_TX_GPS=17, PIN_BUZZER=25;
TinyGPSPlus gps;
HardwareSerial gpsPort(2);
String idToken, refreshToken;
unsigned long tokenVence=0, ultimoGPS=0, ultimoControl=0, ultimoWifi=0;
bool manual=false, fuera=false, buzzer=false, zonaActiva=false;
double centroLat=0, centroLng=0, radio=300;

int peticion(const String &url,const String &metodo,const String &cuerpo,String &respuesta,bool form=false){
 WiFiClientSecure client; client.setInsecure(); // SOLO prototipo; en producción validar certificado
 HTTPClient http; http.setTimeout(8000);
 if(!http.begin(client,url))return -1;
 http.addHeader("Content-Type",form?"application/x-www-form-urlencoded":"application/json");
 int codigo=metodo=="GET"?http.GET():metodo=="POST"?http.POST(cuerpo):http.PUT(cuerpo);
 respuesta=http.getString();http.end();return codigo;
}

bool autenticar(){
 String respuesta;
 JsonDocument doc;
 doc["email"]=FIREBASE_EMAIL;doc["password"]=FIREBASE_PASSWORD;doc["returnSecureToken"]=true;
 String cuerpo;serializeJson(doc,cuerpo);
 int codigo=peticion(String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=")+FIREBASE_API_KEY,"POST",cuerpo,respuesta);
 if(codigo!=200){Serial.printf("Error autenticación HTTP %d: %s\n",codigo,respuesta.c_str());return false;}
 JsonDocument r;if(deserializeJson(r,respuesta))return false;
 idToken=r["idToken"].as<String>();refreshToken=r["refreshToken"].as<String>();
 tokenVence=millis()+3300000UL;
 Serial.println("Firebase autenticado");return idToken.length()>0;
}

bool tokenListo(){
 if(idToken.length()&&millis()<tokenVence)return true;
 // Reautenticación simple, cada ~55 min. No imprimir credenciales.
 return autenticar();
}

int db(const String &metodo,const String &ruta,const String &cuerpo,String &respuesta){
 if(WiFi.status()!=WL_CONNECTED||!tokenListo())return -1;
 return peticion(String(BASE)+"/dispositivos/gps001/"+ruta+".json?auth="+idToken,metodo,cuerpo,respuesta);
}

void sonar(bool encender){
 if(encender==buzzer)return;
 buzzer=encender;
 if(encender)ledcWriteTone(0,2200);else ledcWriteTone(0,0);
 Serial.println(encender?"BUZZER ENCENDIDO":"BUZZER APAGADO");
}

void leerOrdenes(){
 String respuesta;
 int c=db("GET","control","",respuesta);
 if(c==200){JsonDocument j;if(!deserializeJson(j,respuesta))manual=j["buzzerManual"]|false;}
 else Serial.printf("Control HTTP %d\n",c);
 c=db("GET","zona","",respuesta);
 if(c==200){JsonDocument j;if(!deserializeJson(j,respuesta)&&j.is<JsonObject>()){
 zonaActiva=j["activa"]|false;
 centroLat=j["latitud"]|0.0;centroLng=j["longitud"]|0.0;radio=j["radio"]|300.0;
 if(radio<10||radio>10000)zonaActiva=false;
 }}
}

void calcularAlarma(){
 // Si se pierde la señal, no inventar que la persona está dentro.
 if(zonaActiva&&gps.location.isValid()&&gps.location.age()<15000){
   double metros=TinyGPSPlus::distanceBetween(gps.location.lat(),gps.location.lng(),centroLat,centroLng);
   // Margen de 15 m para reducir activaciones por ruido GPS.
   if(!fuera&&metros>radio+15)fuera=true;
   else if(fuera&&metros<radio-15)fuera=false;
 }else if(!zonaActiva)fuera=false;
 sonar(manual||fuera);
}

void enviarPosicion(){
 if(!gps.location.isValid()||gps.location.age()>10000){Serial.println("Esperando GPS válido...");return;}
 JsonDocument j;
 j["latitud"]=gps.location.lat();j["longitud"]=gps.location.lng();
 j["satelites"]=gps.satellites.isValid()?gps.satellites.value():0;
 j["altitud"]=gps.altitude.isValid()?gps.altitude.meters():0;
 j["timestamp"][".sv"]="timestamp";
 String cuerpo,respuesta;serializeJson(j,cuerpo);
 // PATCH no sobrescribe control, zona o estado.
 if(!tokenListo())return;
 WiFiClientSecure client;client.setInsecure();HTTPClient http;
 if(http.begin(client,String(BASE)+"/dispositivos/gps001.json?auth="+idToken)){
 http.addHeader("Content-Type","application/json");
 int c=http.sendRequest("PATCH",cuerpo);Serial.printf("GPS Firebase HTTP %d\n",c);http.end();
 }
 JsonDocument estado;estado["buzzerEncendido"]=buzzer;estado["fueraZona"]=fuera;
 estado["timestamp"][".sv"]="timestamp";
 serializeJson(estado,cuerpo=String());
 int c=db("PUT","estado",cuerpo,respuesta);
 if(c!=200)Serial.printf("Estado Firebase HTTP %d\n",c);
}

void setup(){
 Serial.begin(115200);gpsPort.begin(9600,SERIAL_8N1,PIN_RX_GPS,PIN_TX_GPS);
 ledcSetup(0,2200,8);ledcAttachPin(PIN_BUZZER,0);ledcWriteTone(0,0);
 WiFi.mode(WIFI_STA);WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
 Serial.print("Conectando WiFi");unsigned long inicio=millis();
 while(WiFi.status()!=WL_CONNECTED&&millis()-inicio<20000){delay(400);Serial.print(".");}
 Serial.println(WiFi.status()==WL_CONNECTED?"\nWiFi conectado":"\nWiFi sin conexión");
 if(WiFi.status()==WL_CONNECTED)autenticar();
}

void loop(){
 while(gpsPort.available())gps.encode(gpsPort.read());
 if(WiFi.status()!=WL_CONNECTED&&millis()-ultimoWifi>10000){ultimoWifi=millis();WiFi.reconnect();}
 if(millis()-ultimoControl>=3000){ultimoControl=millis();if(WiFi.status()==WL_CONNECTED)leerOrdenes();calcularAlarma();}
 if(millis()-ultimoGPS>=5000){ultimoGPS=millis();if(WiFi.status()==WL_CONNECTED)enviarPosicion();}
}
