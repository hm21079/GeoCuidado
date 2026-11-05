
"use strict";

// ============================================
// GEOCUIDADO - GPS + FIREBASE + LEAFLET
// ============================================

const CONFIG = {
  apiKey: "AIzaSyCV_N6ETuzLNTfFSolGY5mRT7v6AO8x_3E",
  databaseURL:
    "https://rastreadorgps-50c1d-default-rtdb.firebaseio.com",
  dispositivo: "gps001",
  intervalo: 3000
};

const BASE = "dispositivos/" + CONFIG.dispositivo;
const $ = id => document.getElementById(id);

// AUTENTICACIÓN
let idToken = null;
let refreshToken = null;
let tokenExpira = 0;
let intervaloGPS = null;

// MAPA
let mapa = null;
let marcador = null;
let circulo = null;

// GPS Y PERÍMETRO
let posicionActual = null;
let centroZona = null;
let radioZona = 50;
let alarmaAutomatica = true;
let fueraAnterior = false;
let actualizando = false;
let historial = [];

// ============================================
// AUTENTICACIÓN FIREBASE
// ============================================

async function iniciarSesion(email, password) {
  const url =
    "https://identitytoolkit.googleapis.com/v1/accounts:" +
    "signInWithPassword?key=" +
    encodeURIComponent(CONFIG.apiKey);

  const respuesta = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });

  const datos = await respuesta.json();

  if (!respuesta.ok) {
    throw new Error(
      datos.error?.message || "Error de autenticación"
    );
  }

  idToken = datos.idToken;
  refreshToken = datos.refreshToken;

  tokenExpira =
    Date.now() +
    Number(datos.expiresIn || 3600) * 1000;
}

async function tokenActual() {
  if (!idToken) {
    throw new Error("Debes iniciar sesión");
  }

  if (Date.now() < tokenExpira - 60000) {
    return idToken;
  }

  const url =
    "https://securetoken.googleapis.com/v1/token?key=" +
    encodeURIComponent(CONFIG.apiKey);

  const respuesta = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":
        "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  const datos = await respuesta.json();

  if (!respuesta.ok) {
    throw new Error("Sesión caducada");
  }

  idToken = datos.id_token;
  refreshToken = datos.refresh_token;

  tokenExpira =
    Date.now() +
    Number(datos.expires_in || 3600) * 1000;

  return idToken;
}

// ============================================
// FIREBASE REALTIME DATABASE
// ============================================

async function firebaseRequest(
  ruta,
  metodo = "GET",
  datos
) {
  const token = await tokenActual();

  const url =
    CONFIG.databaseURL + "/" +
    ruta + ".json?auth=" +
    encodeURIComponent(token);

  const opciones = {
    method: metodo,
    headers: {
      "Content-Type": "application/json"
    }
  };

  if (datos !== undefined) {
    opciones.body = JSON.stringify(datos);
  }

  const respuesta = await fetch(url, opciones);
  const resultado = await respuesta.json();

  if (!respuesta.ok) {
    throw new Error(
      typeof resultado.error === "string"
        ? resultado.error
        : "Error Firebase " + respuesta.status
    );
  }

  return resultado;
}

// ============================================
// MAPA DE EL SALVADOR
// ============================================

function iniciarMapa() {
  if (mapa) return;

  // Ubicación inicial en El Salvador
  const inicial = [13.703783, -89.173117];

  mapa = L.map("map", {
    center: inicial,
    zoom: 17,
    zoomControl: true
  });

  // Cartografía de Esri, sin clave
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        "Tiles &copy; Esri",
      maxZoom: 19
    }
  ).addTo(mapa);

  marcador = L.circleMarker(inicial, {
    radius: 9,
    color: "#ffffff",
    weight: 3,
    fillColor: "#3b82f6",
    fillOpacity: 1
  }).addTo(mapa);

  marcador.bindPopup(
    "<strong>Dispositivo GPS</strong><br>gps001"
  );

  circulo = L.circle(inicial, {
    radius: radioZona,
    color: "#10b981",
    weight: 2,
    fillColor: "#10b981",
    fillOpacity: 0.15
  }).addTo(mapa);

  setTimeout(() => {
    mapa.invalidateSize();
  }, 300);
}

function actualizarMarcador() {
  if (!mapa || !marcador || !posicionActual) {
    return;
  }

  const ubicacion = [
    posicionActual.lat,
    posicionActual.lng
  ];

  marcador.setLatLng(ubicacion);
  mapa.panTo(ubicacion);
}

function actualizarCirculo() {
  if (!circulo || !centroZona) return;

  circulo.setLatLng([
    centroZona.lat,
    centroZona.lng
  ]);

  circulo.setRadius(radioZona);
}

// ============================================
// CALCULAR DISTANCIA
// ============================================

function distanciaMetros(a, b) {
  const R = 6371000;
  const rad = grados => grados * Math.PI / 180;

  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);

  const valor =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) *
    Math.cos(rad(b.lat)) *
    Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.atan2(
    Math.sqrt(valor),
    Math.sqrt(1 - valor)
  );
}

// ============================================
// CONSULTAR GPS DESDE FIREBASE
// ============================================

async function consultarGPS() {
  if (actualizando || !idToken) return;

  actualizando = true;

  try {
    const datos = await firebaseRequest(BASE);

    if (!datos) {
      $("estadoGPS").textContent =
        "Sin datos del GPS";

      $("conexion").textContent = "Sin datos";
      return;
    }

    const lat = Number(datos.latitud);
    const lng = Number(datos.longitud);

    if (
      datos.latitud == null ||
      datos.longitud == null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      $("estadoGPS").textContent =
        "Esperando GPS...";
      return;
    }

    posicionActual = { lat, lng };

    $("conexion").textContent = "Datos recibidos";

    $("coordenadas").textContent =
      lat.toFixed(6) + ", " + lng.toFixed(6);

    $("satelites").textContent =
      "Satélites: " + (datos.satelites ?? "--");

    $("ultimaActualizacion").textContent =
      "Última consulta: " +
      new Date().toLocaleTimeString("es-SV");

    $("googleLink").href =
      "https://www.google.com/maps?q=" +
      lat + "," + lng;

    actualizarMarcador();

    if (!centroZona) {
      centroZona = { ...posicionActual };
      actualizarCirculo();
    }

    await comprobarPerimetro();

    // Consultar el comando actual del buzzer
    if (datos.control &&
        typeof datos.control.buzzer === "boolean") {
      $("buzzerEstado").textContent =
        datos.control.buzzer
          ? "Comando: ACTIVAR"
          : "Comando: DESACTIVAR";
    }

  } catch (error) {
    $("conexion").textContent =
      "Error de conexión";

    mostrarMensaje(error.message);
    console.error(error);

  } finally {
    actualizando = false;
  }
}

// ============================================
// CONTROL DEL BUZZER
// ============================================

async function enviarBuzzer(
  activar,
  origen = "manual"
) {
  await firebaseRequest(
    BASE + "/control/buzzer",
    "PUT",
    activar
  );

  $("buzzerEstado").textContent =
    activar
      ? "Comando: ACTIVAR"
      : "Comando: DESACTIVAR";

  registrarAlerta(
    activar
      ? "Buzzer activado (" + origen + ")"
      : "Buzzer desactivado (" + origen + ")"
  );

  mostrarMensaje(
    "Comando enviado a Firebase. " +
    "Pendiente de confirmación del ESP32."
  );
}

// ============================================
// GUARDAR ZONA DE SEGURIDAD
// ============================================

async function guardarZona() {
  if (!posicionActual) {
    mostrarMensaje(
      "Todavía no hay ubicación GPS"
    );
    return;
  }

  const nuevaZona = {
    latitud: posicionActual.lat,
    longitud: posicionActual.lng,
    radio: radioZona,
    alarmaAutomatica
  };

  await firebaseRequest(
    BASE + "/zona",
    "PUT",
    nuevaZona
  );

  centroZona = { ...posicionActual };
  fueraAnterior = false;

  actualizarCirculo();
  await comprobarPerimetro();

  mostrarMensaje(
    "Zona de seguridad guardada correctamente"
  );
}

// ============================================
// PROTECCIÓN PERIMETRAL
// ============================================

async function comprobarPerimetro() {
  if (!posicionActual || !centroZona) return;

  const distancia = distanciaMetros(
    centroZona,
    posicionActual
  );

  const fuera = distancia > radioZona;

  $("distancia").textContent =
    "Distancia al centro: " +
    distancia.toFixed(1) + " m";

  $("estadoGPS").textContent =
    fuera
      ? "Fuera de la zona segura"
      : "Dentro de la zona segura";

  $("zonaEstado").textContent =
    fuera
      ? "ALERTA: dispositivo fuera del perímetro"
      : "Dispositivo dentro del perímetro";

  if (circulo) {
    circulo.setStyle({
      color: fuera ? "#ef4444" : "#10b981",
      fillColor: fuera ? "#ef4444" : "#10b981"
    });
  }

  if (fuera && !fueraAnterior) {
    registrarAlerta("Salida del perímetro");

    if (alarmaAutomatica) {
      try {
        await enviarBuzzer(true, "perímetro");
      } catch (error) {
        mostrarMensaje(error.message);
      }
    }
  }

  if (!fuera && fueraAnterior) {
    registrarAlerta("Regreso a zona segura");

    if (alarmaAutomatica) {
      try {
        await enviarBuzzer(false, "perímetro");
      } catch (error) {
        mostrarMensaje(error.message);
      }
    }
  }

  fueraAnterior = fuera;
}

// ============================================
// HISTORIAL DE ALERTAS
// ============================================

function registrarAlerta(texto) {
  historial.unshift({
    fecha: new Date().toLocaleString("es-SV"),
    texto
  });

  historial = historial.slice(0, 100);

  const contenedor = $("historial");
  contenedor.replaceChildren();

  historial.forEach(item => {
    const div = document.createElement("div");

    div.textContent =
      item.fecha + " — " + item.texto;

    contenedor.appendChild(div);
  });
}

function mostrarMensaje(texto) {
  $("mensaje").textContent = texto;
}

// ============================================
// INICIAR SESIÓN
// ============================================

$("loginForm").addEventListener(
  "submit",
  async e => {
    e.preventDefault();

    $("loginError").textContent = "";

    try {
      await iniciarSesion(
        $("email").value.trim(),
        $("password").value
      );

      $("password").value = "";

      // Recuperar zona guardada
      try {
        const zona = await firebaseRequest(
          BASE + "/zona"
        );

        if (zona) {
          const radio = Number(zona.radio);

          if (
            Number.isFinite(radio) &&
            radio >= 20 &&
            radio <= 1000
          ) {
            radioZona = radio;
          }

          if (
            zona.latitud != null &&
            zona.longitud != null &&
            Number.isFinite(Number(zona.latitud)) &&
            Number.isFinite(Number(zona.longitud))
          ) {
            centroZona = {
              lat: Number(zona.latitud),
              lng: Number(zona.longitud)
            };
          }

          alarmaAutomatica =
            zona.alarmaAutomatica !== false;

          $("radio").value = radioZona;

          $("radioTexto").textContent =
            radioZona + " m";

          $("alarmaAuto").checked =
            alarmaAutomatica;
        }

      } catch (error) {
        mostrarMensaje(
          "No se pudo leer la zona: " +
          error.message
        );
      }

      $("login").classList.add("hidden");

      iniciarMapa();
      actualizarCirculo();

      await consultarGPS();

      clearInterval(intervaloGPS);

      intervaloGPS = setInterval(
        consultarGPS,
        CONFIG.intervalo
      );

    } catch (error) {
      $("loginError").textContent =
        error.message;
    }
  }
);

// ============================================
// CERRAR SESIÓN
// ============================================

$("logout").addEventListener("click", () => {
  clearInterval(intervaloGPS);
  intervaloGPS = null;

  idToken = null;
  refreshToken = null;
  tokenExpira = 0;

  $("login").classList.remove("hidden");
  $("conexion").textContent = "Desconectado";
});

// ============================================
// CONTROL DEL RADIO
// ============================================

$("radio").addEventListener("input", e => {
  radioZona = Number(e.target.value);

  $("radioTexto").textContent =
    radioZona + " m";

  actualizarCirculo();
});

// ============================================
// BOTÓN GUARDAR ZONA
// ============================================

$("guardarZona").addEventListener(
  "click",
  async () => {
    try {
      await guardarZona();
    } catch (error) {
      mostrarMensaje(error.message);
    }
  }
);

// ============================================
// ACTIVAR BUZZER
// ============================================

$("buzzerOn").addEventListener(
  "click",
  async () => {
    try {
      await enviarBuzzer(true);
    } catch (error) {
      mostrarMensaje(error.message);
    }
  }
);

// ============================================
// DESACTIVAR BUZZER
// ============================================

$("buzzerOff").addEventListener(
  "click",
  async () => {
    try {
      await enviarBuzzer(false);
    } catch (error) {
      mostrarMensaje(error.message);
    }
  }
);

// ============================================
// ALARMA AUTOMÁTICA
// ============================================

$("alarmaAuto").addEventListener(
  "change",
  async e => {
    const anterior = alarmaAutomatica;
    alarmaAutomatica = e.target.checked;

    try {
      await firebaseRequest(
        BASE + "/zona/alarmaAutomatica",
        "PUT",
        alarmaAutomatica
      );

      mostrarMensaje(
        alarmaAutomatica
          ? "Alarma automática habilitada"
          : "Alarma automática deshabilitada"
      );

    } catch (error) {
      alarmaAutomatica = anterior;
      $("alarmaAuto").checked = anterior;
      mostrarMensaje(error.message);
    }
  }
);

// ============================================
// ACTUALIZAR DATOS
// ============================================

$("actualizarDatos").addEventListener(
  "click",
  consultarGPS
);

// ============================================
// NAVEGACIÓN DEL DASHBOARD
// ============================================

document.querySelectorAll(".nav").forEach(
  boton => {
    boton.addEventListener("click", () => {
      document.querySelectorAll(".nav").forEach(
        b => b.classList.remove("active")
      );

      document.querySelectorAll(".view").forEach(
        v => v.classList.remove("active")
      );

      boton.classList.add("active");

      $(boton.dataset.view).classList.add(
        "active"
      );

      if (
        boton.dataset.view === "inicio" &&
        mapa
      ) {
        setTimeout(() => {
          mapa.invalidateSize();
        }, 150);
      }
    });
  }
);

console.log("GeoCuidado iniciado correctamente");
