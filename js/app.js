/* ==========================================================================
   Núcleo de la aplicación: conexión, ingreso con PIN, navegación y ayudas
   de interfaz que usan todas las pantallas.
   ========================================================================== */

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

const ROLES = ['Admin', 'Gerente', 'Recepcion', 'Estilista'];
const NOMBRE_ROL = { Admin: 'Administrador', Gerente: 'Gerente', Recepcion: 'Recepción', Estilista: 'Estilista' };
const TODOS = ROLES;
const GERENCIA = ['Admin', 'Gerente'];
const MOSTRADOR = ['Admin', 'Gerente', 'Recepcion'];

/* --------------------------------------------------------------------------
   Utilidades
   -------------------------------------------------------------------------- */

/** Escapa texto para meterlo en HTML. Úsalo SIEMPRE con datos de la base. */
function h(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const Fmt = {
  L(n) {
    const v = Number(n || 0);
    return (App.config.moneda || 'L') + ' ' + v.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  num(n, dec = 2) { return Number(n || 0).toLocaleString('es-HN', { maximumFractionDigits: dec }); },
  /** 'YYYY-MM-DD' de una fecha local */
  iso(d = new Date()) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  hoy() { return Fmt.iso(new Date()); },
  sumarDias(iso, dias) { const d = Fmt.aFecha(iso); d.setDate(d.getDate() + dias); return Fmt.iso(d); },
  aFecha(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); },
  fecha(v) {
    if (!v) return '';
    const d = typeof v === 'string' && v.length === 10 ? Fmt.aFecha(v) : new Date(v);
    return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' });
  },
  fechaLarga(iso) {
    return Fmt.aFecha(iso).toLocaleDateString('es-HN', { weekday: 'long', day: 'numeric', month: 'long' });
  },
  hora(v) {
    if (!v) return '';
    if (/^\d{2}:\d{2}/.test(v)) return v.slice(0, 5);
    return new Date(v).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' });
  },
  fechaHora(v) { return v ? Fmt.fecha(v) + ' ' + Fmt.hora(v) : ''; },
  /** Rango [desde, hasta) en ISO UTC para filtrar timestamps por días locales */
  rangoDias(desdeIso, hastaIso) {
    return [Fmt.aFecha(desdeIso).toISOString(), Fmt.aFecha(Fmt.sumarDias(hastaIso, 1)).toISOString()];
  },
  minutos(hhmm) { const [a, b] = hhmm.split(':').map(Number); return a * 60 + b; },
  hhmm(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); },
  hora12(hhmm) {
    const [a, b] = hhmm.split(':').map(Number);
    return ((a % 12) || 12) + ':' + String(b).padStart(2, '0') + (a < 12 ? ' am' : ' pm');
  },
  inicial(nombre) { return (String(nombre || '?').trim()[0] || '?').toUpperCase(); },
  /** Teléfono para WhatsApp: 8 dígitos hondureños reciben +504 */
  telefonoWa(tel) {
    const d = String(tel || '').replace(/\D/g, '');
    if (!d) return '';
    return d.length === 8 ? '504' + d : d;
  }
};

function redondear(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

function enlaceWhatsApp(telefono, texto) {
  const t = Fmt.telefonoWa(telefono);
  return 'https://wa.me/' + t + '?text=' + encodeURIComponent(texto);
}

/** Convierte errores técnicos en mensajes entendibles. */
function traducirError(e) {
  const msg = (e && (e.message || e.error_description || e.msg)) || String(e);
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return new Error('No hay conexión a internet. Revise el wifi e intente de nuevo.');
  if (/JWT expired|invalid JWT|not authenticated/i.test(msg)) return new Error('Su sesión expiró. Vuelva a ingresar.');
  if (/row-level security|permission denied/i.test(msg)) return new Error('No tiene permiso para esta acción.');
  if (e && e.code === '23505') return new Error('Ya existe un registro con ese nombre o código.');
  if (e && e.code === '23503') return new Error('No se puede: este registro está en uso.');
  return new Error(msg);
}

/** Ejecuta una consulta de Supabase y lanza un error legible si falla. */
/** Ejecuta una consulta y lanza el error traducido. Mientras hay consultas en
 *  curso se muestra una barrita arriba para que el usuario sepa que espera. */
let consultasEnCurso = 0;
async function q(consulta) {
  if (consultasEnCurso++ === 0) document.body.classList.add('ocupado');
  try {
    const { data, error } = await consulta;
    if (error) throw traducirError(error);
    return data;
  } finally {
    if (--consultasEnCurso === 0) document.body.classList.remove('ocupado');
  }
}
const rpc = (fn, args) => q(sb.rpc(fn, args || {}));

/** Limpia texto de búsqueda para usarlo en filtros .or() */
function limpiarBusqueda(t) { return String(t || '').replace(/[,()%*\\]/g, ' ').trim(); }

function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* --------------------------------------------------------------------------
   Interfaz: avisos, ventanas, formularios
   -------------------------------------------------------------------------- */

const UI = {
  aviso(texto, tipo = '') {
    const el = document.createElement('div');
    el.className = 'aviso-flotante ' + tipo;
    const icono = tipo === 'error' ? 'exclamation-circle-fill' : tipo === 'ok' ? 'check-circle-fill' : 'info-circle-fill';
    el.innerHTML = `<i class="bi bi-${icono}"></i><span>${h(texto)}</span>`;
    document.getElementById('avisos').appendChild(el);
    setTimeout(() => el.remove(), tipo === 'error' ? 6000 : 3200);
  },
  ok(texto) { UI.aviso(texto, 'ok'); },
  error(e) { UI.aviso(e && e.message ? e.message : String(e), 'error'); },

  /**
   * Abre una ventana. opciones = { titulo, cuerpo (html o nodo), ancho, botones: [{texto, clase, icono, accion}] }
   * Si la acción de un botón devuelve false, la ventana no se cierra.
   */
  modal(op) {
    const fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    fondo.innerHTML = `
      <div class="modal ${op.ancho ? 'ancho' : ''}" role="dialog" aria-modal="true">
        <div class="modal-cab"><h3>${h(op.titulo || '')}</h3>
          <button class="btn-icono" data-cerrar aria-label="Cerrar"><i class="bi bi-x-lg"></i></button></div>
        <div class="modal-cuerpo"></div>
        <div class="modal-pie"></div>
      </div>`;
    const cuerpo = fondo.querySelector('.modal-cuerpo');
    if (typeof op.cuerpo === 'string') cuerpo.innerHTML = op.cuerpo; else if (op.cuerpo) cuerpo.appendChild(op.cuerpo);
    const pie = fondo.querySelector('.modal-pie');
    const ctl = {
      el: fondo, cuerpo,
      cerrar() { fondo.remove(); document.removeEventListener('keydown', esc); if (op.alCerrar) op.alCerrar(); }
    };
    const esc = (ev) => { if (ev.key === 'Escape' && document.querySelector('.modal-fondo:last-child') === fondo) ctl.cerrar(); };
    document.addEventListener('keydown', esc);
    (op.botones || [{ texto: 'Cerrar', clase: 'sec' }]).forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.clase || '');
      btn.innerHTML = (b.icono ? `<i class="bi bi-${b.icono}"></i>` : '') + h(b.texto);
      btn.onclick = async () => {
        if (!b.accion) return ctl.cerrar();
        btn.disabled = true;
        try { const r = await b.accion(ctl); if (r !== false) ctl.cerrar(); }
        catch (e) { UI.error(e); }
        finally { btn.disabled = false; }
      };
      pie.appendChild(btn);
    });
    fondo.querySelector('[data-cerrar]').onclick = () => ctl.cerrar();
    fondo.addEventListener('mousedown', ev => { if (ev.target === fondo) ctl.cerrar(); });
    document.getElementById('capa-modal').appendChild(fondo);
    const primero = cuerpo.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
    if (primero && !op.sinFoco && window.innerWidth > 700) setTimeout(() => primero.focus(), 50);
    return ctl;
  },

  confirmar(texto, { titulo = '¿Está seguro?', si = 'Sí, continuar', peligro = false } = {}) {
    return new Promise(res => {
      let respuesta = false;
      UI.modal({
        titulo, cuerpo: `<p style="font-size:1.05rem;margin:4px 0 8px">${texto}</p>`,
        alCerrar: () => res(respuesta),
        botones: [
          { texto: 'Cancelar', clase: 'sec' },
          { texto: si, clase: peligro ? 'peligro' : '', accion: () => { respuesta = true; } }
        ]
      });
    });
  },

  /** Pide datos con un formulario simple. Devuelve los valores o null si cancela. */
  pedir(titulo, campos, { boton = 'Guardar', valores = {} } = {}) {
    return new Promise(res => {
      let listo = false;
      const m = UI.modal({
        titulo, cuerpo: Form.html(campos, valores),
        alCerrar: () => { if (!listo) res(null); },
        botones: [
          { texto: 'Cancelar', clase: 'sec' },
          { texto: boton, accion: () => { const v = Form.leer(m.cuerpo, campos); listo = true; res(v); } }
        ]
      });
    });
  },

  cargando(el) { el.innerHTML = '<div class="cargando-bloque"><span class="giro"></span></div>'; },
  vacio(icono, texto) { return `<div class="vacio"><i class="bi bi-${icono}"></i>${h(texto)}</div>`; }
};

/**
 * Formularios declarativos.
 * campo = { n: nombre, t: etiqueta, tipo: text|number|select|textarea|check|date|time|color|tel|email|password,
 *           op: [[valor, texto]], req: true, ayuda, ancho: true, min, max, paso, ph, lista: id datalist }
 */
const Form = {
  html(campos, v = {}) {
    return '<div class="campos">' + campos.map(c => Form.campo(c, v[c.n])).join('') + '</div>';
  },
  campo(c, valor) {
    const id = 'f-' + c.n;
    const val = valor ?? c.def ?? '';
    const req = c.req ? ' required' : '';
    const ancho = c.ancho || c.tipo === 'textarea' ? ' ancho' : '';
    if (c.tipo === 'check') {
      return `<label class="check${ancho}"><input type="checkbox" name="${c.n}" ${val === true || val === 'true' ? 'checked' : ''}> ${h(c.t)}</label>`;
    }
    let control;
    if (c.tipo === 'select') {
      control = `<select id="${id}" name="${c.n}"${req}>` +
        (c.vacio !== undefined ? `<option value="">${h(c.vacio)}</option>` : '') +
        c.op.map(([ov, ot]) => `<option value="${h(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${h(ot)}</option>`).join('') +
        '</select>';
    } else if (c.tipo === 'textarea') {
      control = `<textarea id="${id}" name="${c.n}" placeholder="${h(c.ph || '')}"${req}>${h(val)}</textarea>`;
    } else {
      const tipo = c.tipo || 'text';
      const extra = (c.min !== undefined ? ` min="${c.min}"` : '') + (c.max !== undefined ? ` max="${c.max}"` : '') +
        (c.paso ? ` step="${c.paso}"` : (tipo === 'number' ? ' step="any"' : '')) +
        (c.lista ? ` list="${c.lista}"` : '') + (c.inputmode ? ` inputmode="${c.inputmode}"` : '') +
        (c.maxlen ? ` maxlength="${c.maxlen}"` : '') + (c.soloLectura ? ' readonly' : '');
      control = `<input id="${id}" name="${c.n}" type="${tipo}" value="${h(val)}" placeholder="${h(c.ph || '')}"${extra}${req} autocomplete="off">`;
    }
    return `<div class="campo${ancho}"><label for="${id}">${h(c.t)}${c.req ? ' *' : ''}</label>${control}` +
      (c.ayuda ? `<span class="ayuda">${h(c.ayuda)}</span>` : '') + '</div>';
  },
  /** Lee y valida. Lanza error con el nombre del primer campo requerido vacío. */
  leer(raiz, campos) {
    const r = {};
    for (const c of campos) {
      const el = raiz.querySelector(`[name="${c.n}"]`);
      if (!el) continue;
      let v;
      if (c.tipo === 'check') v = el.checked;
      else if (c.tipo === 'number') v = el.value === '' ? null : Number(el.value);
      else v = el.value.trim();
      if (c.req && (v === '' || v === null)) { el.focus(); throw new Error('Complete el campo "' + c.t + '".'); }
      if (c.tipo === 'number' && v !== null && c.min !== undefined && v < c.min) { el.focus(); throw new Error('"' + c.t + '" no puede ser menor que ' + c.min + '.'); }
      r[c.n] = v;
    }
    return r;
  }
};

/**
 * Buscador de clientes con lista desplegable. Devuelve el nodo; llama onElegir(cliente|null).
 * Incluye opción para crear un cliente nuevo al vuelo.
 */
function selectorCliente({ valor = null, onElegir, permitirMostrador = true, placeholder = 'Buscar cliente por nombre o teléfono…' }) {
  const cont = document.createElement('div');
  cont.className = 'selector';
  cont.innerHTML = `<div class="buscador"><i class="bi bi-search"></i><input type="search" placeholder="${h(placeholder)}" autocomplete="off"></div>
    <div class="selector-lista oculto"></div>`;
  const input = cont.querySelector('input');
  const lista = cont.querySelector('.selector-lista');
  let actual = valor;
  if (actual) input.value = actual.nombre;

  const elegir = (c) => {
    actual = c; input.value = c ? c.nombre : ''; lista.classList.add('oculto');
    onElegir && onElegir(c);
  };
  const buscar = debounce(async () => {
    const t = limpiarBusqueda(input.value);
    let consulta = sb.from('clientes').select('id,nombre,telefono,credito_habilitado,limite_credito').eq('activo', true).order('nombre').limit(12);
    if (t) consulta = consulta.or(`nombre.ilike.%${t}%,telefono.ilike.%${t}%`);
    try {
      const filas = await q(consulta);
      lista.innerHTML =
        (permitirMostrador ? '<button data-i="-1"><i class="bi bi-shop"></i> Cliente de mostrador (sin registrar)</button>' : '') +
        filas.map((c, i) => `<button data-i="${i}"><strong>${h(c.nombre)}</strong> <small>${h(c.telefono || '')}</small></button>`).join('') +
        (puede(MOSTRADOR) ? `<button data-nuevo><i class="bi bi-person-plus"></i> Registrar cliente nuevo${t ? ': <strong>' + h(input.value) + '</strong>' : ''}</button>` : '');
      lista.classList.remove('oculto');
      lista.querySelectorAll('button').forEach(b => b.onmousedown = async (ev) => {
        ev.preventDefault();
        if (b.dataset.nuevo !== undefined) {
          const c = await nuevoClienteRapido(input.value);
          if (c) elegir(c);
        } else {
          const i = Number(b.dataset.i);
          elegir(i < 0 ? null : filas[i]);
        }
      });
    } catch (e) { UI.error(e); }
  });
  input.addEventListener('focus', buscar);
  input.addEventListener('input', buscar);
  input.addEventListener('blur', () => setTimeout(() => {
    lista.classList.add('oculto');
    if (actual && input.value !== actual.nombre) input.value = actual.nombre;
    if (!actual && input.value) input.value = '';
  }, 150));
  cont.limpiar = () => { actual = null; input.value = ''; };
  cont.poner = (c) => { actual = c; input.value = c ? c.nombre : ''; };
  return cont;
}

async function nuevoClienteRapido(nombreInicial = '') {
  const v = await UI.pedir('Nuevo cliente', [
    { n: 'nombre', t: 'Nombre completo', req: true, ancho: true },
    { n: 'telefono', t: 'Teléfono', tipo: 'tel', inputmode: 'tel' },
    { n: 'fecha_nacimiento', t: 'Cumpleaños', tipo: 'date' }
  ], { valores: { nombre: /\d/.test(nombreInicial) ? '' : nombreInicial, telefono: /\d/.test(nombreInicial) ? nombreInicial : '' } });
  if (!v) return null;
  try {
    const c = await q(sb.from('clientes').insert({ nombre: v.nombre, telefono: v.telefono, fecha_nacimiento: v.fecha_nacimiento || null })
      .select('id,nombre,telefono,credito_habilitado,limite_credito').single());
    UI.ok('Cliente registrado.');
    return c;
  } catch (e) { UI.error(e); return null; }
}

/* --------------------------------------------------------------------------
   Aplicación: sesión, datos comunes y navegación
   -------------------------------------------------------------------------- */

const App = {
  perfil: null,
  config: { moneda: 'L' },
  datos: { empleados: [], servicios: [], categorias: [], marcas: [], proveedores: [] },
  caja: null,
  vistas: {},
  orden: [],
  vistaActual: null,

  async iniciar() {
    if (CONFIG.SUPABASE_URL.includes('TU-PROYECTO')) {
      return this.pantallaMensaje('Falta configurar la conexión',
        'Abra el archivo <b>js/config.js</b> y escriba la dirección y la llave de su proyecto de Supabase (vea la guía LEEME).');
    }
    window.addEventListener('hashchange', () => this.navegar());
    this.vigilarInactividad();
    try {
      const { data } = await sb.auth.getSession();
      if (data.session && await this.cargarPerfil()) return this.entrar();
    } catch (e) { console.error(e); }
    this.mostrarLogin();
  },

  pantallaMensaje(titulo, html) {
    document.getElementById('pantalla-carga').classList.add('oculto');
    const p = document.getElementById('pantalla-login');
    p.classList.remove('oculto');
    p.innerHTML = `<div class="login-caja"><img src="img/logo.png" class="logo-grande" alt=""><h2>${h(titulo)}</h2><p>${html}</p></div>`;
  },

  /* ----- Ingreso -------------------------------------------------------- */

  async mostrarLogin() {
    document.getElementById('app').classList.add('oculto');
    document.getElementById('pantalla-carga').classList.add('oculto');
    const p = document.getElementById('pantalla-login');
    p.classList.remove('oculto');
    p.innerHTML = '<div class="login-caja"><img src="img/logo.png" class="logo-grande" alt=""><div class="cargando-bloque"><span class="giro"></span></div></div>';
    try {
      const hay = await rpc('hay_usuarios');
      if (!hay) return this.pantallaPrimerAdmin();
      const personas = await rpc('lista_login');
      this.pantallaPersonas(personas);
    } catch (e) {
      p.querySelector('.cargando-bloque').innerHTML = `<p>${h(e.message)}</p><button class="btn" onclick="location.reload()">Reintentar</button>`;
    }
  },

  pantallaPersonas(personas) {
    const p = document.getElementById('pantalla-login');
    p.innerHTML = `<div class="login-caja">
      <img src="img/logo.png" class="logo-grande" alt="Gaby's Salón">
      <h2>¡Hola! ¿Quién eres?</h2><p>Toca tu nombre para entrar</p>
      <div class="lista-personas">${personas.map((u, i) => `
        <button class="persona" data-i="${i}"><span class="avatar">${h(Fmt.inicial(u.nombre))}</span>${h(u.nombre)}</button>`).join('')}
      </div></div>`;
    p.querySelectorAll('.persona').forEach(b => b.onclick = () => this.pantallaPin(personas[Number(b.dataset.i)], personas));
  },

  pantallaPin(persona, personas) {
    const p = document.getElementById('pantalla-login');
    p.innerHTML = `<div class="login-caja">
      <span class="avatar" style="width:72px;height:72px;font-size:2rem;margin:0 auto 10px">${h(Fmt.inicial(persona.nombre))}</span>
      <h2>${h(persona.nombre)}</h2><p>Escribe tu PIN de 4 números</p>
      <div class="pin-puntos"><span></span><span></span><span></span><span></span></div>
      <div class="teclado">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="tecla" data-n="${n}">${n}</button>`).join('')}
        <button class="tecla sin-fondo" data-volver>Volver</button>
        <button class="tecla" data-n="0">0</button>
        <button class="tecla sin-fondo" data-borrar aria-label="Borrar"><i class="bi bi-backspace"></i></button>
      </div>
      <p id="pin-msg" class="mt" style="min-height:1.5em;color:var(--rojo);font-weight:700"></p>
    </div>`;
    let pin = '';
    let ocupado = false;
    const puntos = p.querySelector('.pin-puntos');
    const pintar = () => puntos.querySelectorAll('span').forEach((s, i) => s.classList.toggle('lleno', i < pin.length));
    const msg = p.querySelector('#pin-msg');

    const intentar = async () => {
      ocupado = true;
      msg.innerHTML = '<span class="giro" style="width:20px;height:20px"></span>';
      const bloqueo = this.bloqueoPin(persona.usuario);
      if (bloqueo) { msg.textContent = bloqueo; pin = ''; pintar(); ocupado = false; return; }
      const { error } = await sb.auth.signInWithPassword({
        email: persona.usuario + '@' + CONFIG.DOMINIO_USUARIOS,
        password: 'GS-' + pin + '-salon'
      });
      if (error) {
        this.registrarFalloPin(persona.usuario);
        puntos.classList.remove('error'); void puntos.offsetWidth; puntos.classList.add('error');
        msg.textContent = /Invalid login/i.test(error.message) ? 'PIN incorrecto. Intenta de nuevo.' : traducirError(error).message;
        pin = ''; pintar(); ocupado = false;
        return;
      }
      localStorage.removeItem('gs-fallos-' + persona.usuario);
      if (await this.cargarPerfil()) this.entrar();
      else { await sb.auth.signOut(); msg.textContent = 'Este usuario está desactivado. Hable con la administración.'; pin = ''; pintar(); ocupado = false; }
    };
    const tecla = (n) => {
      if (ocupado || pin.length >= 4) return;
      pin += n; pintar(); msg.textContent = '';
      if (pin.length === 4) intentar();
    };
    p.querySelectorAll('[data-n]').forEach(b => b.onclick = () => tecla(b.dataset.n));
    p.querySelector('[data-borrar]').onclick = () => { if (!ocupado) { pin = pin.slice(0, -1); pintar(); } };
    p.querySelector('[data-volver]').onclick = () => { document.removeEventListener('keydown', teclas); this.pantallaPersonas(personas); };
    const teclas = (ev) => {
      if (document.getElementById('pantalla-login').classList.contains('oculto')) return document.removeEventListener('keydown', teclas);
      if (/^\d$/.test(ev.key)) tecla(ev.key);
      if (ev.key === 'Backspace' && !ocupado) { pin = pin.slice(0, -1); pintar(); }
    };
    document.addEventListener('keydown', teclas);
  },

  /** Freno local tras varios PIN incorrectos (Supabase además limita intentos por IP). */
  bloqueoPin(usuario) {
    try {
      const f = JSON.parse(localStorage.getItem('gs-fallos-' + usuario) || '{"n":0,"t":0}');
      if (f.n >= 5) {
        const espera = 60000 * Math.pow(2, Math.min(f.n - 5, 4)) - (Date.now() - f.t);
        if (espera > 0) return `Demasiados intentos. Espere ${Math.ceil(espera / 60000)} minuto(s).`;
      }
    } catch (e) { /* almacenamiento no disponible */ }
    return '';
  },
  registrarFalloPin(usuario) {
    try {
      const f = JSON.parse(localStorage.getItem('gs-fallos-' + usuario) || '{"n":0,"t":0}');
      localStorage.setItem('gs-fallos-' + usuario, JSON.stringify({ n: f.n + 1, t: Date.now() }));
    } catch (e) { /* almacenamiento no disponible */ }
  },

  pantallaPrimerAdmin() {
    const p = document.getElementById('pantalla-login');
    const campos = [
      { n: 'nombre', t: 'Su nombre', req: true, ancho: true },
      { n: 'usuario', t: 'Usuario (sin espacios)', req: true, ph: 'ej. gaby', ancho: true },
      { n: 'pin', t: 'PIN de 4 números', tipo: 'password', req: true, inputmode: 'numeric', maxlen: 4 },
      { n: 'pin2', t: 'Repita el PIN', tipo: 'password', req: true, inputmode: 'numeric', maxlen: 4 }
    ];
    p.innerHTML = `<div class="login-caja" style="text-align:left">
      <div class="centro"><img src="img/logo.png" class="logo-grande" alt=""><h2>Bienvenida</h2>
      <p>Es la primera vez que se usa el sistema. Cree la cuenta de administración.</p></div>
      <form>${Form.html(campos)}<button class="btn grande" type="submit">Crear administrador</button></form></div>`;
    p.querySelector('form').onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = p.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const v = Form.leer(p, campos);
        const usuario = normalizarUsuario(v.usuario);
        if (!/^\d{4}$/.test(v.pin)) throw new Error('El PIN debe tener exactamente 4 números.');
        if (v.pin !== v.pin2) throw new Error('Los dos PIN no coinciden.');
        const { data, error } = await sb.auth.signUp({ email: usuario + '@' + CONFIG.DOMINIO_USUARIOS, password: 'GS-' + v.pin + '-salon' });
        if (error) throw traducirError(error);
        if (!data.session) throw new Error('Supabase pide confirmar el correo. Desactive "Confirm email" en Authentication > Sign In / Providers > Email (vea la guía) y vuelva a intentar.');
        await rpc('registrar_primer_admin', { p_usuario: usuario, p_nombre: v.nombre });
        if (await this.cargarPerfil()) this.entrar();
      } catch (e) { UI.error(e); btn.disabled = false; }
    };
  },

  async cargarPerfil() {
    const { data: u } = await sb.auth.getUser();
    if (!u || !u.user) return false;
    const perfil = await q(sb.from('perfiles').select('*').eq('id', u.user.id).maybeSingle()).catch(() => null);
    if (!perfil || !perfil.activo) return false;
    this.perfil = perfil;
    return true;
  },

  async entrar() {
    document.getElementById('pantalla-login').classList.add('oculto');
    document.getElementById('pantalla-carga').classList.remove('oculto');
    try { await this.cargarDatos(); }
    catch (e) { UI.error(e); }
    document.getElementById('pantalla-carga').classList.add('oculto');
    document.getElementById('app').classList.remove('oculto');
    document.getElementById('usuario-inicial').textContent = Fmt.inicial(this.perfil.nombre);
    document.getElementById('usuario-nombre').textContent = this.perfil.nombre.split(' ')[0];
    document.getElementById('btn-usuario').onclick = () => this.menuUsuario();
    document.getElementById('chip-caja').onclick = () => { if (puede(MOSTRADOR)) location.hash = '#/caja'; };
    this.pintarNav();
    this.pintarCaja();
    this.navegar();
  },

  /** Catálogos que usan varias pantallas. Se recargan tras editar. */
  async cargarDatos() {
    const esMostrador = puede(MOSTRADOR);
    const [config, empleados, servicios, categorias, marcas, proveedores, caja] = await Promise.all([
      q(sb.from('configuracion').select('*').eq('id', 1).single()),
      q(sb.from('empleados').select('*').order('nombre')),
      q(sb.from('servicios').select('*').order('nombre')),
      q(sb.from('categorias').select('*').order('nombre')),
      esMostrador ? q(sb.from('marcas').select('*').order('nombre')) : [],
      esMostrador ? q(sb.from('proveedores').select('*').order('nombre')) : [],
      esMostrador ? q(sb.from('cajas').select('*').eq('estado', 'Abierta').maybeSingle()) : null
    ]);
    this.config = config;
    Object.assign(this.datos, { empleados, servicios, categorias, marcas, proveedores });
    this.caja = caja;
    document.title = config.nombre_negocio;
  },

  async refrescarCaja() {
    this.caja = await q(sb.from('cajas').select('*').eq('estado', 'Abierta').maybeSingle());
    this.pintarCaja();
    return this.caja;
  },

  pintarCaja() {
    const chip = document.getElementById('chip-caja');
    if (!puede(MOSTRADOR)) { chip.classList.add('oculto'); return; }
    chip.classList.remove('oculto');
    chip.className = 'chip-caja ' + (this.caja ? 'abierta' : 'cerrada');
    chip.innerHTML = this.caja ? '<i class="bi bi-unlock-fill"></i> Caja abierta' : '<i class="bi bi-lock-fill"></i> Caja cerrada';
  },

  pintarNav() {
    const nav = document.getElementById('barra-nav');
    nav.innerHTML = this.vistasPermitidas().map(v =>
      `<a href="#/${v.id}" data-id="${v.id}" data-titulo="${h(v.titulo)}" aria-label="${h(v.titulo)}"><i class="bi bi-${v.icono}"></i></a>`).join('');
  },

  vistasPermitidas() {
    return this.orden.map(id => this.vistas[id]).filter(v => v.menu !== false && puede(v.roles));
  },

  menuUsuario() {
    const viejo = document.querySelector('.menu-usuario');
    if (viejo) return viejo.remove();
    const m = document.createElement('div');
    m.className = 'menu-usuario';
    m.innerHTML = `<div class="cabeza"><strong>${h(this.perfil.nombre)}</strong><br><small class="suave">${h(NOMBRE_ROL[this.perfil.rol])}</small></div>
      <button data-a="pin"><i class="bi bi-key"></i> Cambiar mi PIN</button>
      <button data-a="recargar"><i class="bi bi-arrow-clockwise"></i> Actualizar datos</button>
      <button data-a="salir"><i class="bi bi-box-arrow-right"></i> Salir / cambiar de usuario</button>`;
    document.body.appendChild(m);
    const cerrar = (ev) => { if (!m.contains(ev.target) && !ev.target.closest('#btn-usuario')) { m.remove(); document.removeEventListener('mousedown', cerrar); } };
    setTimeout(() => document.addEventListener('mousedown', cerrar));
    m.querySelectorAll('button').forEach(b => b.onclick = async () => {
      m.remove();
      if (b.dataset.a === 'salir') this.salir();
      if (b.dataset.a === 'recargar') { await this.cargarDatos(); this.pintarCaja(); this.navegar(); UI.ok('Datos actualizados.'); }
      if (b.dataset.a === 'pin') cambiarPin(this.perfil.id, true);
    });
  },

  async salir(motivo) {
    await sb.auth.signOut().catch(() => {});
    this.perfil = null;
    document.getElementById('capa-modal').innerHTML = '';
    location.hash = '';
    if (motivo) UI.aviso(motivo);
    this.mostrarLogin();
  },

  /** Cierra la sesión tras un tiempo sin uso: en recepción la computadora es compartida. */
  vigilarInactividad() {
    let ultimo = Date.now();
    ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(ev => document.addEventListener(ev, () => { ultimo = Date.now(); }, { passive: true }));
    setInterval(() => {
      const min = Number(this.config.minutos_inactividad || 30);
      if (this.perfil && min > 0 && Date.now() - ultimo > min * 60000) this.salir('Se cerró la sesión por inactividad.');
    }, 30000);
  },

  /* ----- Navegación ----------------------------------------------------- */

  navegar() {
    if (!this.perfil) return;
    const [ruta, consulta] = (location.hash.replace(/^#\/?/, '') || 'inicio').split('?');
    const params = Object.fromEntries(new URLSearchParams(consulta || ''));
    let v = this.vistas[ruta];
    if (!v || !puede(v.roles)) v = this.vistas.inicio;
    this.vistaActual = v.id;
    document.getElementById('titulo-vista').textContent = v.id === 'inicio' ? '' : v.titulo;
    document.getElementById('btn-volver').classList.toggle('oculto', v.id === 'inicio');
    document.querySelectorAll('#barra-nav a').forEach(a => a.classList.toggle('activo', a.dataset.id === v.id));
    document.querySelector('.menu-usuario')?.remove();
    document.getElementById('capa-modal').innerHTML = '';
    const cont = document.getElementById('vista');
    cont.innerHTML = '';
    window.scrollTo(0, 0);
    Promise.resolve(v.render(cont, params)).catch(e => { cont.innerHTML = UI.vacio('exclamation-triangle', e.message); });
  }
};

/** Registra una pantalla. roles: quién la ve. */
function vista(id, def) {
  App.vistas[id] = Object.assign({ id, roles: TODOS }, def);
  App.orden.push(id);
}

function puede(roles) { return !!App.perfil && roles.includes(App.perfil.rol); }

function normalizarUsuario(t) {
  const u = String(t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.');
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new Error('El usuario debe tener de 3 a 30 letras o números, sin espacios ni símbolos.');
  return u;
}

async function cambiarPin(idPerfil, propio) {
  const v = await UI.pedir(propio ? 'Cambiar mi PIN' : 'Nuevo PIN', [
    { n: 'pin', t: 'PIN nuevo (4 números)', tipo: 'password', req: true, inputmode: 'numeric', maxlen: 4 },
    { n: 'pin2', t: 'Repita el PIN', tipo: 'password', req: true, inputmode: 'numeric', maxlen: 4 }
  ], { boton: 'Cambiar PIN' });
  if (!v) return;
  try {
    if (!/^\d{4}$/.test(v.pin)) throw new Error('El PIN debe tener exactamente 4 números.');
    if (v.pin !== v.pin2) throw new Error('Los dos PIN no coinciden.');
    await rpc('cambiar_pin', { p_id: idPerfil, p_pin: v.pin });
    UI.ok('PIN actualizado.');
  } catch (e) { UI.error(e); }
}

/** Abre la caja desde cualquier pantalla. Devuelve true si quedó abierta. */
async function abrirCajaDialogo() {
  const v = await UI.pedir('Abrir caja', [
    { n: 'monto', t: 'Efectivo con el que inicia la caja (L)', tipo: 'number', req: true, min: 0, def: 0, inputmode: 'decimal', ancho: true,
      ayuda: 'Cuente el dinero que hay en la gaveta antes de empezar.' }
  ], { boton: 'Abrir caja' });
  if (!v) return false;
  try {
    await rpc('abrir_caja', { p_monto: v.monto });
    await App.refrescarCaja();
    UI.ok('Caja abierta. ¡Buen día!');
    return true;
  } catch (e) { UI.error(e); return false; }
}

/** Opciones de empleados activos para un <select>. */
function opcionesEmpleados(seleccionado) {
  return App.datos.empleados.filter(e => e.activo).map(e =>
    `<option value="${e.id}" ${String(e.id) === String(seleccionado) ? 'selected' : ''}>${h(e.nombre)}</option>`).join('');
}
const nombreDe = (lista, id) => (App.datos[lista].find(x => String(x.id) === String(id)) || {}).nombre || '';
