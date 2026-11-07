"use strict";

/*
==================================================
GEOCUIDADO - CUIDADOS Y NOTIFICACIONES
==================================================
Funciones:
- Agenda de medicamentos y actividades
- Repeticiones programadas
- Responsables y teléfonos
- Notificaciones internas
- Avisos y alertas de perímetro
- Integración con Firebase Realtime Database
- Compatible con Leaflet + Esri

Requiere que js/app.js se cargue primero.
==================================================
*/

(() => {
  // ==========================================
  // 1. VARIABLES GENERALES
  // ==========================================

  const el = id => document.getElementById(id);

  let cuidados = {};
  let responsables = {};
  let avisos = {};
  let notificaciones = {};

  let reloj = null;
  let sincronizador = null;

  let cargando = false;
  let revisando = false;
  let sincronizando = false;

  let sesion = 0;
  let notificacionesCargadas = false;

  // ==========================================
  // 2. UTILIDADES
  // ==========================================

  // Escapar texto para evitar HTML no deseado.
  function esc(valor) {
    return String(valor ?? "").replace(
      /[&<>"']/g,
      c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[c])
    );
  }

  // Fecha local YYYY-MM-DD.
  function fechaLocal(d) {
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");
  }

  // Hora local HH:MM.
  function horaLocal(d) {
    return (
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  function fechaUTC(s) {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function fechaValida(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) {
      return false;
    }

    const t = fechaUTC(s);

    return Number.isFinite(t) &&
      new Date(t).toISOString().slice(0, 10) === s;
  }

  function diasEntre(a, b) {
    return Math.round(
      (fechaUTC(b) - fechaUTC(a)) / 86400000
    );
  }

  function fechaBonita(s) {
    return s
      ? s.split("-").reverse().join("/")
      : "Todos los días";
  }

  const nombresSemana = [
    "Dom", "Lun", "Mar", "Mié",
    "Jue", "Vie", "Sáb"
  ];

  function configurarFecha() {
    if (!el("fechaCuidado").value) {
      el("fechaCuidado").value =
        fechaLocal(new Date());
    }
  }

  function informar(error) {
    console.error(error);
    mostrarMensaje(error.message || String(error));
  }

  // ==========================================
  // 3. OPCIONES DE REPETICIÓN
  // ==========================================

  function mostrarOpciones() {
    const r = el("repeticionCuidado").value;

    el("opcionesSemana").hidden =
      r !== "semanal" &&
      r !== "personalizado-semanas";

    el("opcionesMes").hidden =
      r !== "mensual";

    el("opcionesIntervalo").hidden =
      !r.startsWith("personalizado-");

    el("finRepeticionContenedor").hidden =
      !r || r === "unica";

    el("intervaloUnidad").textContent =
      r === "personalizado-dias"
        ? "días"
        : r === "personalizado-semanas"
          ? "semanas"
          : "meses";
  }

  function inicioSemana(fecha) {
    const t = fechaUTC(fecha);
    const dia = new Date(t).getUTCDay();

    return new Date(
      t - ((dia + 6) % 7) * 86400000
    ).toISOString().slice(0, 10);
  }

  // Verificar si un recordatorio corresponde
  // a la fecha actual.
  function coincideFecha(c, hoy) {
    if (!c.fecha) return true;

    if (
      hoy < c.fecha ||
      (c.fechaFin && hoy > c.fechaFin)
    ) {
      return false;
    }

    const r = c.repeticion || "diaria";

    if (r === "unica") {
      return hoy === c.fecha;
    }

    if (r === "diaria") {
      return true;
    }

    const diaSemana =
      new Date(fechaUTC(hoy)).getUTCDay();

    if (r === "semanal") {
      return (c.diasSemana || [])
        .includes(diaSemana);
    }

    if (r === "mensual") {
      return (c.diasMes || [])
        .includes(Number(hoy.slice(8)));
    }

    const n = Number(c.intervalo) || 1;

    if (r === "personalizado-dias") {
      return diasEntre(c.fecha, hoy) % n === 0;
    }

    if (r === "personalizado-semanas") {
      const semanas = diasEntre(
        inicioSemana(c.fecha),
        inicioSemana(hoy)
      ) / 7;

      return semanas % n === 0 &&
        (c.diasSemana || []).includes(diaSemana);
    }

    if (r === "personalizado-meses") {
      const [ya, ma, da] =
        c.fecha.split("-").map(Number);

      const [yb, mb, db] =
        hoy.split("-").map(Number);

      const meses = (yb - ya) * 12 + (mb - ma);

      return meses % n === 0 && db === da;
    }

    return false;
  }

  function descripcionRepeticion(c) {
    const r = c.repeticion;

    if (!r) {
      return "Todos los días (registro anterior)";
    }

    if (r === "unica") return "Una sola vez";
    if (r === "diaria") return "Todos los días";

    if (r === "semanal") {
      return "Semanal: " +
        (c.diasSemana || [])
          .map(d => nombresSemana[d])
          .join(", ");
    }

    if (r === "mensual") {
      return "Mensual: días " +
        (c.diasMes || []).join(", ");
    }

    if (r === "personalizado-dias") {
      return `Cada ${c.intervalo} día(s)`;
    }

    if (r === "personalizado-semanas") {
      return `Cada ${c.intervalo} semana(s): ` +
        (c.diasSemana || [])
          .map(d => nombresSemana[d])
          .join(", ");
    }

    if (r === "personalizado-meses") {
      return `Cada ${c.intervalo} mes(es), día ${
        Number(c.fecha.slice(8))
      }`;
    }

    return "Sin definir";
  }

  // ==========================================
  // 4. NAVEGACIÓN
  // ==========================================

  function abrirSeccion(id) {
    document.querySelectorAll(".nav")
      .forEach(b => {
        b.classList.toggle(
          "active",
          b.dataset.view === id
        );
      });

    document.querySelectorAll(".view")
      .forEach(v => {
        v.classList.toggle(
          "active",
          v.id === id
        );
      });

    el("notificationDropdown").hidden = true;

    el("notificationBell").setAttribute(
      "aria-expanded",
      "false"
    );

    // Corregir tamaño del mapa Leaflet.
    if (
      id === "inicio" &&
      typeof mapa !== "undefined" &&
      mapa
    ) {
      setTimeout(() => {
        mapa.invalidateSize();
      }, 150);
    }
  }

  // ==========================================
  // 5. NOTIFICACIONES
  // ==========================================

  function tituloTipo(tipo) {
    return {
      medicamento: "💊 Medicamento",
      aseo: "🧼 Aseo personal",
      caminata: "🚶 Salida a caminar",
      otro: "📅 Actividad programada",
      perimetro: "🚨 Alerta de seguridad",
      regreso: "✅ Regreso a zona segura"
    }[tipo] || "🔔 GeoCuidado";
  }

  function listaOrdenada() {
    return Object.entries(notificaciones)
      .sort((a, b) =>
        String(b[1]?.fecha || "").localeCompare(
          String(a[1]?.fecha || "")
        )
      );
  }

  function tarjetaNotificacion(id, n) {
    const fecha = n.fecha
      ? new Date(n.fecha).toLocaleString("es-SV")
      : "Sin fecha";

    return `
      <div class="notification-entry ${
        n.leida ? "" : "unread"
      }">
        <strong>
          ${esc(n.titulo || tituloTipo(n.tipo))}
        </strong>

        <p>${esc(n.mensaje)}</p>

        <span class="notification-date">
          ${esc(fecha)}
        </span>

        <div class="notification-actions">
          ${
            !n.leida
              ? `
                <button
                  data-leer-notificacion="${esc(id)}"
                  type="button">
                  Marcar como leída
                </button>
              `
              : `
                <span class="notification-date">
                  ✓ Leída
                </span>
              `
          }
        </div>
      </div>
    `;
  }

  function pintarNotificaciones() {
    const lista = listaOrdenada();

    const pendientes = lista.filter(
      ([, n]) => !n.leida
    ).length;

    const contador = el("notificationCount");

    contador.textContent =
      pendientes > 99
        ? "99+"
        : String(pendientes);

    contador.hidden = pendientes === 0;

    el("notificationPreview").innerHTML =
      lista.length
        ? lista.slice(0, 5)
            .map(([id, n]) =>
              tarjetaNotificacion(id, n)
            ).join("")
        : `
          <p class="notification-empty">
            Sin notificaciones.
          </p>
        `;

    el("notificationList").innerHTML =
      lista.length
        ? lista.map(([id, n]) =>
            tarjetaNotificacion(id, n)
          ).join("")
        : `
          <p class="notification-empty">
            No hay notificaciones registradas.
          </p>
        `;
  }

  // Notificación emergente.
  function mostrarToast(titulo, mensaje, tipo) {
    const contenedor =
      el("notificationToastContainer");

    const caja = document.createElement("div");

    caja.className =
      "notification-toast " +
      (
        tipo === "perimetro"
          ? "warning"
          : tipo === "regreso"
            ? "success"
            : ""
      );

    const encabezado =
      document.createElement("strong");

    encabezado.textContent = titulo;

    const parrafo = document.createElement("p");
    parrafo.textContent = mensaje;

    const boton = document.createElement("button");
    boton.type = "button";
    boton.textContent = "Ver notificaciones";

    boton.addEventListener("click", () => {
      abrirSeccion("alertas");
      caja.remove();
    });

    caja.append(encabezado, parrafo, boton);
    contenedor.prepend(caja);

    while (contenedor.children.length > 4) {
      contenedor.lastElementChild.remove();
    }

    setTimeout(() => caja.remove(), 10000);
  }

  // Guardar notificación en Firebase.
  async function crearNotificacion(
    tipo,
    mensaje,
    mostrar = true
  ) {
    if (!idToken) return;

    const registro = {
      tipo,
      titulo: tituloTipo(tipo),
      mensaje,
      fecha: new Date().toISOString(),
      leida: false
    };

    const r = await firebaseRequest(
      BASE + "/notificaciones",
      "POST",
      registro
    );

    notificaciones[r.name] = registro;

    pintarNotificaciones();

    if (mostrar) {
      mostrarToast(
        registro.titulo,
        mensaje,
        tipo
      );
    }

    return r.name;
  }

  async function marcarLeida(id) {
    if (!notificaciones[id]) return;

    await firebaseRequest(
      BASE + "/notificaciones/" + id + "/leida",
      "PUT",
      true
    );

    notificaciones[id].leida = true;

    pintarNotificaciones();
  }

  async function marcarTodas() {
    const pendientes = listaOrdenada()
      .filter(([, n]) => !n.leida);

    for (const [id] of pendientes) {
      try {
        await marcarLeida(id);
      } catch (error) {
        console.error(
          "Error al marcar notificación:",
          error
        );
      }
    }
  }

  // Sincronizar notificaciones desde Firebase.
  async function actualizarNotificaciones() {
    if (!idToken || sincronizando) return;

    sincronizando = true;

    const actual = sesion;

    try {
      const datos = await firebaseRequest(
        BASE + "/notificaciones"
      );

      if (actual !== sesion || !idToken) return;

      const anteriores = new Set(
        Object.keys(notificaciones)
      );

      const nuevos = datos || {};

      if (notificacionesCargadas) {
        Object.entries(nuevos)
          .forEach(([id, n]) => {
            if (
              !anteriores.has(id) &&
              !n.leida
            ) {
              mostrarToast(
                n.titulo || tituloTipo(n.tipo),
                n.mensaje,
                n.tipo
              );
            }
          });
      }

      notificaciones = nuevos;
      notificacionesCargadas = true;

      pintarNotificaciones();

    } catch (error) {
      console.error(
        "Error al actualizar notificaciones:",
        error
      );
    } finally {
      sincronizando = false;
    }
  }

  // ==========================================
  // 6. MOSTRAR AGENDA DE CUIDADOS
  // ==========================================

  function pintarCuidados() {
    const lista = Object.entries(cuidados)
      .sort((a, b) =>
        String(a[1].fecha || "").localeCompare(
          String(b[1].fecha || "")
        ) ||
        String(a[1].hora || "").localeCompare(
          String(b[1].hora || "")
        )
      );

    el("listaCuidados").innerHTML =
      lista.length
        ? lista.map(([id, c]) => `
          <div class="care-item">
            <strong>
              ${esc(c.tipo)}: ${esc(c.nombre)}
            </strong>

            <p>
              <b>Inicio:</b>
              ${esc(fechaBonita(c.fecha))}
              ·
              <b>Hora:</b> ${esc(c.hora)}
            </p>

            <p>
              <b>Indicaciones:</b>
              ${esc(c.detalle || "Sin indicaciones")}
            </p>

            <p>
              <b>Repetición:</b>
              ${esc(descripcionRepeticion(c))}
            </p>

            ${
              c.fechaFin
                ? `
                  <p>
                    <b>Hasta:</b>
                    ${esc(fechaBonita(c.fechaFin))}
                  </p>
                `
                : ""
            }

            <div class="care-actions">
              <button
                type="button"
                data-borrar-cuidado="${esc(id)}"
                class="delete">
                Eliminar
              </button>
            </div>
          </div>
        `).join("")
        : "<p>No hay recordatorios programados.</p>";
  }

  // ==========================================
  // 7. MOSTRAR RESPONSABLES
  // ==========================================

  function pintarResponsables() {
    const lista = Object.entries(responsables);

    el("listaResponsables").innerHTML =
      lista.length
        ? lista.map(([id, r]) => `
          <div class="care-item">
            <strong>
              ${esc(r.nombre)} · ${esc(r.tipo)}
            </strong>

            <p>
              <b>Celular:</b>
              ${esc(r.telefono || "No registrado")}
            </p>

            <p>
              ${
                r.whatsappAutorizado === true
                  ? "WhatsApp autorizado"
                  : "WhatsApp no autorizado"
              }
            </p>

            <div class="care-actions">
              <button
                type="button"
                data-borrar-responsable="${esc(id)}"
                class="delete">
                Eliminar
              </button>
            </div>
          </div>
        `).join("")
        : "<p>No hay responsables registrados.</p>";
  }

  // ==========================================
  // 8. AVISOS DEL SISTEMA
  // ==========================================

  function pintarAvisos() {
    const lista = Object.entries(avisos)
      .sort((a, b) =>
        String(b[1].fecha || "").localeCompare(
          String(a[1].fecha || "")
        )
      ).slice(0, 40);

    el("avisosPendientes").innerHTML =
      lista.length
        ? lista.map(([, a]) => `
          <div class="care-item">
            <strong>${esc(a.tipo)}</strong>

            <p>${esc(a.mensaje)}</p>

            <p>
              ${esc(
                a.fecha
                  ? new Date(a.fecha)
                      .toLocaleString("es-SV")
                  : "Sin fecha"
              )}
            </p>
          </div>
        `).join("")
        : "<p>No hay avisos registrados.</p>";
  }

  async function guardarAviso(tipo, mensaje) {
    const registro = {
      tipo,
      mensaje,
      fecha: new Date().toISOString(),
      estado: "Registrado en GeoCuidado"
    };

    const r = await firebaseRequest(
      BASE + "/avisos",
      "POST",
      registro
    );

    avisos[r.name] = registro;

    pintarAvisos();
  }

  // ==========================================
  // 9. EJECUTAR RECORDATORIOS
  // ==========================================

  async function revisarRecordatorios() {
    if (!idToken || revisando) return;

    revisando = true;

    try {
      const ahora = new Date();
      const hoy = fechaLocal(ahora);
      const hora = horaLocal(ahora);

      for (const [id, c] of Object.entries(cuidados)) {
        // Comprobar hora.
        if (c.hora !== hora) continue;

        // Comprobar repetición.
        if (!coincideFecha(c, hoy)) continue;

        // Ruta de ejecución del recordatorio.
        const ruta =
          BASE + "/ejecuciones/" + id + "/" + hoy;

        try {
          const token = await tokenActual();

          const url =
            CONFIG.databaseURL + "/" +
            ruta + ".json?auth=" +
            encodeURIComponent(token);

          // Solicitar ETag para evitar duplicados.
          const lectura = await fetch(url, {
            headers: {
              "X-Firebase-ETag": "true"
            }
          });

          if (!lectura.ok) {
            throw Error(
              "No se pudo consultar la ejecución"
            );
          }

          const valor = await lectura.json();

          // Ya se ejecutó hoy.
          if (valor !== null) continue;

          const etag =
            lectura.headers.get("ETag");

          if (!etag) continue;

          // Registrar la ejecución una sola vez.
          const escritura = await fetch(url, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "if-match": etag
            },
            body: JSON.stringify({
              fecha: ahora.toISOString()
            })
          });

          if (!escritura.ok) continue;

          const texto =
            `${c.nombre}` +
            (
              c.detalle
                ? " — " + c.detalle
                : ""
            );

          // Crear notificación.
          await crearNotificacion(
            c.tipo,
            texto,
            true
          );

          // Registrar en historial GPS.
          registrarAlerta(
            "Recordatorio: " + texto
          );

          // Registrar aviso en Firebase.
          await guardarAviso(
            "Recordatorio de " + c.tipo,
            texto
          );

        } catch (error) {
          console.error(
            "Error de recordatorio:",
            error
          );
        }
      }
    } finally {
      revisando = false;
    }
  }

  // ==========================================
  // 10. CARGAR DATOS DE FIREBASE
  // ==========================================

  async function cargar() {
    if (cargando || !idToken) return;

    cargando = true;

    const actual = sesion;

    try {
      const [c, r, a, n] = await Promise.all([
        firebaseRequest(BASE + "/cuidados"),
        firebaseRequest(BASE + "/responsables"),
        firebaseRequest(BASE + "/avisos"),
        firebaseRequest(BASE + "/notificaciones")
      ]);

      if (actual !== sesion || !idToken) return;

      cuidados = c || {};
      responsables = r || {};
      avisos = a || {};
      notificaciones = n || {};

      notificacionesCargadas = true;

      pintarCuidados();
      pintarResponsables();
      pintarAvisos();
      pintarNotificaciones();

      configurarFecha();

      // Revisar recordatorios cada 15 segundos.
      if (!reloj) {
        reloj = setInterval(
          revisarRecordatorios,
          15000
        );
      }

      // Sincronizar notificaciones.
      if (!sincronizador) {
        sincronizador = setInterval(
          actualizarNotificaciones,
          15000
        );
      }

      await revisarRecordatorios();

    } catch (error) {
      mostrarMensaje(
        "Error al cargar cuidados: " +
        error.message
      );
    } finally {
      cargando = false;
    }
  }

  // ==========================================
  // 11. GUARDAR RECORDATORIOS
  // ==========================================

  el("formCuidado").addEventListener(
    "submit",
    async e => {
      e.preventDefault();

      try {
        const rep =
          el("repeticionCuidado").value;

        const dato = {
          tipo: el("tipoCuidado").value,
          nombre: el("nombreCuidado").value.trim(),
          detalle: el("detalleCuidado").value.trim(),
          fecha: el("fechaCuidado").value,
          hora: el("horaCuidado").value,
          repeticion: rep,
          fechaFin: rep === "unica"
            ? ""
            : el("fechaFinCuidado").value,
          creado: new Date().toISOString()
        };

        // Validar campos principales.
        if (
          !dato.nombre ||
          !fechaValida(dato.fecha) ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(
            dato.hora
          )
        ) {
          throw Error(
            "Completa nombre, fecha y hora válidos."
          );
        }

        if (!rep) {
          throw Error(
            "Selecciona una frecuencia de repetición."
          );
        }

        // Validar fecha de finalización.
        if (
          dato.fechaFin &&
          (
            !fechaValida(dato.fechaFin) ||
            dato.fechaFin < dato.fecha
          )
        ) {
          throw Error(
            "La fecha final debe ser igual o posterior al inicio."
          );
        }

        // Días de la semana.
        if (
          rep === "semanal" ||
          rep === "personalizado-semanas"
        ) {
          dato.diasSemana = [
            ...document.querySelectorAll(
              'input[name="diasSemana"]:checked'
            )
          ].map(x => Number(x.value));

          if (!dato.diasSemana.length) {
            throw Error(
              "Selecciona al menos un día de la semana."
            );
          }
        }

        // Días del mes.
        if (rep === "mensual") {
          dato.diasMes = [
            ...document.querySelectorAll(
              'input[name="diasMes"]:checked'
            )
          ].map(x => Number(x.value));

          if (!dato.diasMes.length) {
            throw Error(
              "Selecciona al menos un día del mes."
            );
          }
        }

        // Intervalos personalizados.
        if (rep.startsWith("personalizado-")) {
          dato.intervalo =
            Number(el("intervaloCuidado").value);

          if (
            !Number.isInteger(dato.intervalo) ||
            dato.intervalo < 1 ||
            dato.intervalo > 365
          ) {
            throw Error(
              "El intervalo debe ser de 1 a 365."
            );
          }
        }

        // Guardar en Firebase.
        const r = await firebaseRequest(
          BASE + "/cuidados",
          "POST",
          dato
        );

        cuidados[r.name] = dato;

        pintarCuidados();

        // Limpiar formulario.
        e.target.reset();

        configurarFecha();
        mostrarOpciones();

        mostrarMensaje(
          "Recordatorio guardado correctamente."
        );

      } catch (error) {
        informar(error);
      }
    }
  );

  // ==========================================
  // 12. GUARDAR RESPONSABLES
  // ==========================================

  el("formResponsable").addEventListener(
    "submit",
    async e => {
      e.preventDefault();

      try {
        // El formulario actual no utiliza correo.
        const dato = {
          nombre:
            el("nombreResponsable").value.trim(),

          tipo:
            el("tipoResponsable").value,

          telefono:
            el("telefonoResponsable").value.trim(),

          whatsappAutorizado:
            el("whatsappAutorizado").checked
        };

        if (!dato.nombre) {
          throw Error(
            "Ingresa el nombre del responsable."
          );
        }

        // Validar relación.
        if (
          !["Familiar", "Médico", "Cuidador"]
            .includes(dato.tipo)
        ) {
          throw Error(
            "Selecciona una relación válida."
          );
        }

        // Validar exactamente 8 dígitos.
        if (!/^[0-9]{8}$/.test(dato.telefono)) {
          throw Error(
            "El número celular debe tener exactamente 8 dígitos."
          );
        }

        // Guardar responsable en Firebase.
        const r = await firebaseRequest(
          BASE + "/responsables",
          "POST",
          dato
        );

        responsables[r.name] = dato;

        pintarResponsables();

        e.target.reset();

        mostrarMensaje(
          "Responsable guardado correctamente."
        );

      } catch (error) {
        informar(error);
      }
    }
  );

  // ==========================================
  // 13. ELIMINAR RECORDATORIOS
  // ==========================================

  el("listaCuidados").addEventListener(
    "click",
    async e => {
      const id = e.target.closest(
        "[data-borrar-cuidado]"
      )?.dataset.borrarCuidado;

      if (!id) return;

      if (!confirm("¿Eliminar recordatorio?")) {
        return;
      }

      try {
        await firebaseRequest(
          BASE + "/cuidados/" + id,
          "DELETE"
        );

        delete cuidados[id];

        pintarCuidados();

        mostrarMensaje(
          "Recordatorio eliminado."
        );

      } catch (error) {
        informar(error);
      }
    }
  );

  // ==========================================
  // 14. ELIMINAR RESPONSABLES
  // ==========================================

  el("listaResponsables").addEventListener(
    "click",
    async e => {
      const id = e.target.closest(
        "[data-borrar-responsable]"
      )?.dataset.borrarResponsable;

      if (!id) return;

      if (!confirm("¿Eliminar responsable?")) {
        return;
      }

      try {
        await firebaseRequest(
          BASE + "/responsables/" + id,
          "DELETE"
        );

        delete responsables[id];

        pintarResponsables();

        mostrarMensaje(
          "Responsable eliminado."
        );

      } catch (error) {
        informar(error);
      }
    }
  );

  // ==========================================
  // 15. CONTROLES DE NOTIFICACIONES
  // ==========================================

  // Abrir o cerrar campana.
  el("notificationBell").addEventListener(
    "click",
    () => {
      const panel =
        el("notificationDropdown");

      panel.hidden = !panel.hidden;

      el("notificationBell").setAttribute(
        "aria-expanded",
        String(!panel.hidden)
      );
    }
  );

  // Mostrar centro de notificaciones.
  el("verTodasNotificaciones").addEventListener(
    "click",
    () => abrirSeccion("alertas")
  );

  // Marcar todas como leídas.
  el("marcarTodasLeidas").addEventListener(
    "click",
    async () => {
      try {
        await marcarTodas();
      } catch (error) {
        informar(error);
      }
    }
  );

  // Actualizar notificaciones manualmente.
  el("actualizarNotificaciones").addEventListener(
    "click",
    actualizarNotificaciones
  );

  // Marcar una notificación como leída.
  async function clickNotificacion(e) {
    const id = e.target.closest(
      "[data-leer-notificacion]"
    )?.dataset.leerNotificacion;

    if (!id) return;

    try {
      await marcarLeida(id);
    } catch (error) {
      informar(error);
    }
  }

  el("notificationList").addEventListener(
    "click",
    clickNotificacion
  );

  el("notificationPreview").addEventListener(
    "click",
    clickNotificacion
  );

  // Cerrar campana al hacer clic afuera.
  document.addEventListener("click", e => {
    if (
      !e.target.closest(
        ".notification-wrapper"
      )
    ) {
      el("notificationDropdown").hidden = true;

      el("notificationBell").setAttribute(
        "aria-expanded",
        "false"
      );
    }
  });

  // Cambiar opciones de repetición.
  el("repeticionCuidado").addEventListener(
    "change",
    mostrarOpciones
  );

  // ==========================================
  // 16. EVENTOS DE INICIO DE SESIÓN
  // ==========================================

  document.addEventListener(
    "geocuidado:login",
    () => {
      sesion++;

      cargar();
    }
  );

  // ==========================================
  // 17. EVENTO DE CIERRE DE SESIÓN
  // ==========================================

  document.addEventListener(
    "geocuidado:logout",
    () => {
      sesion++;

      clearInterval(reloj);
      clearInterval(sincronizador);

      reloj = null;
      sincronizador = null;

      cuidados = {};
      responsables = {};
      avisos = {};
      notificaciones = {};

      notificacionesCargadas = false;

      pintarCuidados();
      pintarResponsables();
      pintarAvisos();
      pintarNotificaciones();

      el("notificationToastContainer")
        .replaceChildren();

      el("notificationDropdown").hidden = true;

      el("notificationBell").setAttribute(
        "aria-expanded",
        "false"
      );
    }
  );

  // ==========================================
  // 18. ALERTAS DEL PERÍMETRO
  // ==========================================

  document.addEventListener(
    "geocuidado:perimetro",
    async e => {
      if (!idToken) return;

      const { fuera, posicion } = e.detail;

      const texto =
        (
          fuera
            ? "El dispositivo salió del perímetro de seguridad."
            : "El dispositivo regresó a la zona segura."
        ) +
        ` Ubicación: ${posicion.lat.toFixed(6)}, ` +
        `${posicion.lng.toFixed(6)}. ` +
        `https://www.google.com/maps?q=` +
        `${posicion.lat},${posicion.lng}`;

      try {
        await crearNotificacion(
          fuera ? "perimetro" : "regreso",
          texto,
          true
        );

        // Los avisos externos por WhatsApp
        // se gestionan desde el servidor.
        // No se envían desde el navegador.

      } catch (error) {
        mostrarMensaje(
          "Error al registrar notificación: " +
          error.message
        );
      }
    }
  );

  // ==========================================
  // 19. INICIALIZACIÓN
  // ==========================================

  configurarFecha();
  mostrarOpciones();
  pintarNotificaciones();

  console.log(
    "GeoCuidado: agenda, responsables y " +
    "notificaciones iniciadas correctamente."
  );

})();
