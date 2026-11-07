// Agrega esto a tu sketch actual (el que ya lee el GPS).
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

const char* WIFI_SSID = "TU_WIFI";
const char* WIFI_PASS = "TU_CLAVE";
// Sin "/" al final
const String FB_URL = "https://TU-PROYECTO-default-rtdb.firebaseio.com";

void conectarWiFi() {            // llamar una vez en setup()
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("WiFi OK");
}

void enviarFirebase(double lat, double lng, int sats, double alt) {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();          // suficiente para un prototipo
  HTTPClient http;
  http.begin(client, FB_URL + "/ubicacion.json");
  http.addHeader("Content-Type", "application/json");
  String json = "{\"lat\":" + String(lat, 6) + ",\"lng\":" + String(lng, 6) +
                ",\"sats\":" + String(sats) + ",\"alt\":" + String(alt, 1) +
                ",\"t\":{\".sv\":\"timestamp\"}}";   // Firebase pone la hora
  int code = http.PUT(json);
  Serial.println("Firebase: " + String(code));
  http.end();
}

// En tu loop(), cuando el GPS tenga ubicación válida (cada ~3 s):
// enviarFirebase(gps.location.lat(), gps.location.lng(), gps.satellites.value(), gps.altitude.meters());
