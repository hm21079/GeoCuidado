
"use strict";

// ============================================
// GEOCUIDADO - GPS + FIREBASE + LEAFLET
// ============================================

// Configuración de Firebase y del dispositivo GPS.
const CONFIG = {
  apiKey: "AIzaSyCV_N6ETuzLNTfFSolGY5mRT7v6AO8x_3E",
  databaseURL:
    "https://rastreadorgps-50c1d-default-rtdb.firebaseio.com",
  dispositivo: "gps001",
  intervalo: 3000
};

// Ruta del dispositivo dentro de Firebase.
const BASE = "dispositivos/" + CONFIG.dispositivo;

// Función para obtener elementos del HTML.
const $ = id => document.getElementById(id);

// ============================================
// 1. VARIABLES DE AUTENTICACIÓN
// ============================================

let idToken = null;
let refreshToken = null;
let tokenExpira = 0;
let intervaloGPS = null;

// ============================================
// 2. VARIABLES DEL MAPA LEAFLET
// ============================================

let mapa = null;
let marcador = null;
let circulo = null;

// ============================================
// 3. VARIABLES GPS Y PERÍMETRO
// ============================================

let posicionActual = null;
let centroZona = null;
let radioZona = 50;
let alarmaAutomatica = true;
let fueraAnterior = false;
let actualizando = false;
let historial = [];

// ============================================
// 4. AUTENTICACIÓN FIREBASE
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

// ============================================
// 5. RENOVAR TOKEN FIREBASE
// ============================================

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
// 6. FIREBASE REALTIME DATABASE
// ============================================

// Función general para consultar, guardar,
// modificar o eliminar datos de Firebase.

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
// 7. INICIALIZAR MAPA LEAFLET (SIN API KEY)
// ============================================

function iniciarMapa() {

  // Evitar crear el mapa dos veces.
  if (mapa) return;

  // Ubicación inicial en El Salvador.
  const inicial = [13.703783, -89.173117];

  // Crear mapa con Leaflet.
  // Los botones de zoom se agregan después
  // para controlar su posición.
  mapa = L.map("map", {
    center: inicial,
    zoom: 17,
    zoomControl: false
  });

  // ==========================================
  // CAPA DEL MAPA: OpenStreetMap (sin API key)
  // ==========================================

  const capaOSM = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">' +
        "OpenStreetMap</a> contributors",
      maxZoom: 19
    }
  ).addTo(mapa);

  // Si los mosaicos no cargan, avisar una sola vez.
  let avisoMapa = false;

  capaOSM.on("tileerror", () => {

    if (avisoMapa) return;
    avisoMapa = true;

    mostrarMensaje(
      "No se pudieron cargar los mosaicos de OpenStreetMap. " +
      "Abre la app con Live Server (http://localhost) " +
      "y revisa tu conexión."
    );
  });

  // Escala en metros (útil para ver el perímetro).
  L.control.scale({
    imperial: false,
    position: "bottomleft"
  }).addTo(mapa);

  // Zoom abajo a la derecha.
  L.control.zoom({
    position: "bottomright"
  }).addTo(mapa);

  // ==========================================
  // MARCADOR DEL DISPOSITIVO GPS (CON PULSO)
  // ==========================================

  const iconoGPS = L.divIcon({
    className: "gps-pin",
    html:
      '<span class="pulse"></span>' +
      '<span class="dot"></span>',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16]
  });

  marcador = L.marker(inicial, {
    icon: iconoGPS,
    keyboard: false
  }).addTo(mapa);

  // Información del marcador.
  marcador.bindPopup(
    "<strong>Dispositivo GPS</strong><br>gps001"
  );

  // ==========================================
  // CÍRCULO DE SEGURIDAD
  // ==========================================

  circulo = L.circle(inicial, {
    radius: radioZona,
    color: "#10b981",
    weight: 2.5,
    fillColor: "#10b981",
    fillOpacity: 0.16
  }).addTo(mapa);

  // ==========================================
  // BOTÓN: CENTRAR EN EL DISPOSITIVO
  // ==========================================

  const BotonCentrar = L.Control.extend({

    options: { position: "bottomright" },

    onAdd: function () {

      const caja = L.DomUtil.create(
        "div",
        "leaflet-bar leaflet-control gc-locate"
      );

      const enlace = L.DomUtil.create("a", "", caja);

      enlace.href = "#";
      enlace.title = "Centrar en el dispositivo";
      enlace.setAttribute("role", "button");
      enlace.setAttribute(
        "aria-label",
        "Centrar en el dispositivo"
      );

      enlace.innerHTML =
        '<svg class="ico" style="width:20px;height:20px">' +
        '<use href="#i-crosshair"/></svg>';

      L.DomEvent.disableClickPropagation(caja);

      L.DomEvent.on(enlace, "click", function (e) {

        L.DomEvent.stop(e);

        mapa.setView(
          marcador.getLatLng(),
          Math.max(mapa.getZoom(), 17)
        );
      });

      return caja;
    }
  });

  new BotonCentrar().addTo(mapa);

  // Ajustar el mapa al tamaño del contenedor.
  setTimeout(() => {
    mapa.invalidateSize();
  }, 300);
}

// ============================================
// 8. ACTUALIZAR MARCADOR GPS
// ============================================

function actualizarMarcador() {

  if (!mapa || !marcador || !posicionActual) {
    return;
  }

  const ubicacion = [
    posicionActual.lat,
    posicionActual.lng
  ];

  // Mover el marcador a la posición recibida.
  marcador.setLatLng(ubicacion);

  // Centrar el mapa en el dispositivo.
  mapa.panTo(ubicacion);
}

// ============================================
// 9. ACTUALIZAR CÍRCULO DE SEGURIDAD
// ============================================

function actualizarCirculo() {

  if (!circulo || !centroZona) return;

  // Actualizar centro.
  circulo.setLatLng([
    centroZona.lat,
    centroZona.lng
  ]);

  // Actualizar radio en metros.
  circulo.setRadius(radioZona);
}

// ============================================
// 10. CALCULAR DISTANCIA EN METROS
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
// 11. CONSULTAR GPS DESDE FIREBASE
// ============================================

async function consultarGPS() {

  if (actualizando || !idToken) return;

  actualizando = true;

  try {

    // Obtener información del ESP32.
    const datos = await firebaseRequest(BASE);

    if (!datos) {

      $("estadoGPS").textContent =
        "Sin datos del GPS";

      $("conexion").textContent = "Sin datos";
      return;
    }

    // Obtener latitud y longitud.
    const lat = Number(datos.latitud);
    const lng = Number(datos.longitud);

    // Validar coordenadas GPS.
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

    // Guardar posición actual.
    posicionActual = { lat, lng };

    // Actualizar conexión.
    $("conexion").textContent = "Datos recibidos";

    // Mostrar coordenadas.
    $("coordenadas").textContent =
      lat.toFixed(6) + ", " + lng.toFixed(6);

    // Mostrar satélites.
    $("satelites").textContent =
      "Satélites: " + (datos.satelites ?? "--");

    // Mostrar hora de consulta.
    $("ultimaActualizacion").textContent =
      "Última consulta: " +
      new Date().toLocaleTimeString("es-SV");

    // Enlace para abrir ubicación en Google Maps.
    // Este enlace no modifica el mapa Leaflet.
    $("googleLink").href =
      "https://www.google.com/maps?q=" +
      lat + "," + lng;

    // Actualizar marcador en Leaflet.
    actualizarMarcador();

    // Definir centro inicial de seguridad.
    if (!centroZona) {

      centroZona = { ...posicionActual };

      actualizarCirculo();
    }

    // Comprobar el perímetro.
    await comprobarPerimetro();

    // ========================================
    // ESTADO DEL BUZZER
    // ========================================

    if (
      datos.control &&
      typeof datos.control.buzzer === "boolean"
    ) {

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
// 12. CONTROL DEL BUZZER
// ============================================

async function enviarBuzzer(
  activar,
  origen = "manual"
) {

  // Enviar comando a Firebase.
  await firebaseRequest(
    BASE + "/control/buzzer",
    "PUT",
    activar
  );

  // Actualizar estado.
  $("buzzerEstado").textContent =
    activar
      ? "Comando: ACTIVAR"
      : "Comando: DESACTIVAR";

  // Registrar evento.
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
// 13. GUARDAR ZONA DE SEGURIDAD
// ============================================

async function guardarZona() {

  if (!posicionActual) {

    mostrarMensaje(
      "Todavía no hay ubicación GPS"
    );

    return;
  }

  // Preparar zona de seguridad.
  const nuevaZona = {
    latitud: posicionActual.lat,
    longitud: posicionActual.lng,
    radio: radioZona,
    alarmaAutomatica
  };

  // Guardar en Firebase.
  await firebaseRequest(
    BASE + "/zona",
    "PUT",
    nuevaZona
  );

  // Actualizar centro.
  centroZona = { ...posicionActual };
  fueraAnterior = false;

  // Actualizar círculo.
  actualizarCirculo();

  // Comprobar posición.
  await comprobarPerimetro();

  mostrarMensaje(
    "Zona de seguridad guardada correctamente"
  );
}

// ============================================
// 14. PROTECCIÓN PERIMETRAL
// ============================================

async function comprobarPerimetro() {

  if (!posicionActual || !centroZona) return;

  // Calcular distancia del dispositivo al centro.
  const distancia = distanciaMetros(
    centroZona,
    posicionActual
  );

  // Determinar si salió de la zona.
  const fuera = distancia > radioZona;

  // Mostrar distancia.
  $("distancia").textContent =
    "Distancia al centro: " +
    distancia.toFixed(1) + " m";

  // Mostrar estado GPS.
  $("estadoGPS").textContent =
    fuera
      ? "Fuera de la zona segura"
      : "Dentro de la zona segura";

  // Mostrar estado del perímetro.
  $("zonaEstado").textContent =
    fuera
      ? "ALERTA: dispositivo fuera del perímetro"
      : "Dispositivo dentro del perímetro";

  // ========================================
  // CAMBIAR COLOR DEL CÍRCULO
  // ========================================

  if (circulo) {

    circulo.setStyle({
      color: fuera ? "#ef4444" : "#10b981",
      fillColor: fuera ? "#ef4444" : "#10b981"
    });
  }

  // ========================================
  // SALIDA DEL PERÍMETRO
  // ========================================

  if (fuera && !fueraAnterior) {

    registrarAlerta("Salida del perímetro");

    // Notificar a cuidados.js.
    document.dispatchEvent(
      new CustomEvent("geocuidado:perimetro", {
        detail: {
          fuera: true,
          posicion: { ...posicionActual }
        }
      })
    );

    // Activar alarma automática.
    if (alarmaAutomatica) {

      try {

        await enviarBuzzer(true, "perímetro");

      } catch (error) {

        mostrarMensaje(error.message);
      }
    }
  }

  // ========================================
  // REGRESO A ZONA SEGURA
  // ========================================

  if (!fuera && fueraAnterior) {

    registrarAlerta("Regreso a zona segura");

    // Notificar a cuidados.js.
    document.dispatchEvent(
      new CustomEvent("geocuidado:perimetro", {
        detail: {
          fuera: false,
          posicion: { ...posicionActual }
        }
      })
    );

    // Desactivar alarma automática.
    if (alarmaAutomatica) {

      try {

        await enviarBuzzer(false, "perímetro");

      } catch (error) {

        mostrarMensaje(error.message);
      }
    }
  }

  // Guardar estado anterior.
  fueraAnterior = fuera;
}

// ============================================
// 15. HISTORIAL DE ALERTAS
// ============================================

function registrarAlerta(texto) {

  historial.unshift({
    fecha: new Date().toLocaleString("es-SV"),
    texto
  });

  // Conservar últimos 100 eventos.
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

// ============================================
// 15.1 MODAL DE CONFIRMACIÓN (Sí / No)
// ============================================
//
// Uso:
//   const ok = await confirmarAccion({
//     titulo: "¿Eliminar?",
//     mensaje: "Esta acción no se puede deshacer.",
//     textoConfirmar: "Sí, eliminar",
//     textoCancelar: "No"
//   });
//   if (!ok) return;

function confirmarAccion(opciones = {}) {

  const {
    titulo = "¿Estás seguro?",
    mensaje = "",
    textoConfirmar = "Sí",
    textoCancelar = "No"
  } = opciones;

  const modal = $("modalConfirmar");
  const btnSi = $("modalConfirmarSi");
  const btnNo = $("modalConfirmarNo");

  $("modalConfirmarTitulo").textContent = titulo;
  $("modalConfirmarTexto").textContent = mensaje;
  btnSi.textContent = textoConfirmar;
  btnNo.textContent = textoCancelar;

  const previo = document.activeElement;

  modal.classList.remove("hidden");
  document.body.classList.add("modal-abierto");

  // El foco inicia en "No" para evitar confirmar sin querer.
  btnNo.focus();

  return new Promise(resolve => {

    function cerrar(resultado) {

      modal.classList.add("hidden");
      document.body.classList.remove("modal-abierto");

      btnSi.removeEventListener("click", alSi);
      btnNo.removeEventListener("click", alNo);
      modal.removeEventListener("mousedown", alFondo);
      document.removeEventListener("keydown", alTeclado, true);

      if (previo && previo.focus) previo.focus();

      resolve(resultado);
    }

    const alSi = () => cerrar(true);
    const alNo = () => cerrar(false);

    // Clic fuera de la tarjeta = cancelar.
    const alFondo = e => {
      if (e.target === modal) cerrar(false);
    };

    const alTeclado = e => {

      if (e.key === "Escape") {
        e.preventDefault();
        cerrar(false);
        return;
      }

      // Mantener el foco dentro del modal.
      if (e.key === "Tab") {

        const botones = [btnNo, btnSi];
        const i = botones.indexOf(document.activeElement);

        e.preventDefault();

        const siguiente = e.shiftKey
          ? botones[(i <= 0 ? botones.length : i) - 1]
          : botones[(i + 1) % botones.length];

        siguiente.focus();
      }
    };

    btnSi.addEventListener("click", alSi);
    btnNo.addEventListener("click", alNo);
    modal.addEventListener("mousedown", alFondo);
    document.addEventListener("keydown", alTeclado, true);
  });
}

// ============================================
// 16. MOSTRAR MENSAJES
// ============================================

function mostrarMensaje(texto) {
  $("mensaje").textContent = texto;
}

// ============================================
// 17. INICIAR SESIÓN
// ============================================

$("loginForm").addEventListener(
  "submit",
  async e => {

    e.preventDefault();

    $("loginError").textContent = "";

    try {

      // Autenticar usuario.
      await iniciarSesion(
        $("email").value.trim(),
        $("password").value
      );

      // Limpiar contraseña.
      $("password").value = "";

      // ======================================
      // RECUPERAR ZONA GUARDADA
      // ======================================

      try {

        const zona = await firebaseRequest(
          BASE + "/zona"
        );

        if (zona) {

          const radio = Number(zona.radio);

          // Recuperar radio.
          if (
            Number.isFinite(radio) &&
            radio >= 20 &&
            radio <= 1000
          ) {

            radioZona = radio;
          }

          // Recuperar centro de seguridad.
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

          // Recuperar alarma automática.
          alarmaAutomatica =
            zona.alarmaAutomatica !== false;

          // Actualizar controles.
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

      // Ocultar pantalla de acceso.
      $("login").classList.add("hidden");

      // Avisar a cuidados.js del inicio de sesión.
      document.dispatchEvent(
        new Event("geocuidado:login")
      );

      // ======================================
      // INICIAR MAPA LEAFLET
      // ======================================

      iniciarMapa();
      actualizarCirculo();

      // Consultar primera ubicación.
      await consultarGPS();

      // Actualizar GPS cada 3 segundos.
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
// 18. CERRAR SESIÓN
// ============================================

$("logout").addEventListener(
  "click",
  async () => {

    // Pedir confirmación antes de cerrar la sesión.
    const confirmado = await confirmarAccion({
      titulo: "¿Cerrar sesión?",
      mensaje:
        "Dejarás de ver la ubicación en tiempo real " +
        "hasta que vuelvas a iniciar sesión.",
      textoConfirmar: "Sí, cerrar sesión",
      textoCancelar: "No, quedarme"
    });

    if (!confirmado) return;

    // Detener consultas GPS.
    clearInterval(intervaloGPS);
    intervaloGPS = null;

    // Avisar a cuidados.js.
    document.dispatchEvent(
      new Event("geocuidado:logout")
    );

    // Limpiar sesión.
    idToken = null;
    refreshToken = null;
    tokenExpira = 0;

    // Mostrar login.
    $("login").classList.remove("hidden");

    $("conexion").textContent =
      "Desconectado";
  }
);

// ============================================
// 19. CONTROL DEL RADIO
// ============================================

$("radio").addEventListener(
  "input",
  e => {

    radioZona = Number(e.target.value);

    // Actualizar texto.
    $("radioTexto").textContent =
      radioZona + " m";

    // Actualizar círculo en Leaflet.
    actualizarCirculo();
  }
);

// ============================================
// 20. GUARDAR ZONA
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
// 21. ACTIVAR BUZZER
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
// 22. DESACTIVAR BUZZER
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
// 23. ALARMA AUTOMÁTICA
// ============================================

$("alarmaAuto").addEventListener(
  "change",
  async e => {

    const anterior = alarmaAutomatica;

    alarmaAutomatica = e.target.checked;

    try {

      // Guardar configuración en Firebase.
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

      // Recuperar estado anterior si falla.
      alarmaAutomatica = anterior;

      $("alarmaAuto").checked = anterior;

      mostrarMensaje(error.message);
    }
  }
);

// ============================================
// 24. ACTUALIZAR DATOS MANUALMENTE
// ============================================

$("actualizarDatos").addEventListener(
  "click",
  consultarGPS
);

// ============================================
// 25. NAVEGACIÓN DEL DASHBOARD
// ============================================

document.querySelectorAll(".nav").forEach(
  boton => {

    boton.addEventListener(
      "click",
      () => {

        // Desactivar opciones del menú.
        document.querySelectorAll(".nav")
          .forEach(b => {
            b.classList.remove("active");
          });

        // Ocultar vistas.
        document.querySelectorAll(".view")
          .forEach(v => {
            v.classList.remove("active");
          });

        // Activar opción seleccionada.
        boton.classList.add("active");

        // Mostrar sección correspondiente.
        $(boton.dataset.view).classList.add(
          "active"
        );

        // ====================================
        // REAJUSTAR MAPA LEAFLET
        // ====================================

        if (
          boton.dataset.view === "inicio" &&
          mapa
        ) {

          setTimeout(() => {
            mapa.invalidateSize();
          }, 150);
        }
      }
    );
  }
);

// ============================================
// 26. CONFIRMACIÓN DE INICIALIZACIÓN
// ============================================

console.log(
  "GeoCuidado iniciado correctamente con Leaflet."
);
