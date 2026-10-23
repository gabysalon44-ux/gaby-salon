/* ==========================================================================
   Cobrar: punto de venta.
   Izquierda: productos, servicios y citas de hoy. Derecha: la cuenta.
   La cuenta se conserva si sale de la pantalla y vuelve.
   ========================================================================== */

const Cobro = {
  lineas: [],          // { tipo, item_id, nombre, precio, cantidad, descuento_pct, empleado_id, stock }
  cliente: null,
  cita: null,          // { id, hora }
  metodo: 'Efectivo',
  pagaCon: '',
  prima: '',
  metodoPrima: 'Efectivo',
  credito: null,       // respuesta de saldo_cliente
  pestana: 'productos',
  productos: [],

  vaciar() {
    Object.assign(this, { lineas: [], cliente: null, cita: null, metodo: 'Efectivo', pagaCon: '', prima: '', metodoPrima: 'Efectivo', credito: null });
  },
  totales() {
    let subtotal = 0, descuento = 0;
    for (const l of this.lineas) {
      const bruto = redondear(l.precio * l.cantidad);
      const d = redondear(bruto * (Number(l.descuento_pct) || 0) / 100);
      subtotal += bruto; descuento += d;
    }
    subtotal = redondear(subtotal); descuento = redondear(descuento);
    return { subtotal, descuento, total: redondear(subtotal - descuento) };
  }
};

vista('cobrar', {
  titulo: 'Cobrar', icono: 'cart-check', roles: MOSTRADOR,
  async render(cont, params) {
    cont.innerHTML = `
      <div id="cob-caja"></div>
      <div class="pos">
        <section class="panel">
          <div class="pestanas">
            <button class="pestana" data-p="productos"><i class="bi bi-bag-heart"></i> Productos</button>
            <button class="pestana" data-p="servicios"><i class="bi bi-scissors"></i> Servicios</button>
            <button class="pestana" data-p="agenda"><i class="bi bi-calendar-heart"></i> Citas de hoy</button>
          </div>
          <div class="barra-herramientas" id="cob-filtros">
            <div class="buscador"><i class="bi bi-search"></i><input type="search" id="cob-buscar" placeholder="Buscar por nombre…"></div>
            <select id="cob-cat"></select>
          </div>
          <div class="lista-items" id="cob-lista"></div>
        </section>
        <section class="panel pos-ticket" id="cob-ticket"></section>
      </div>
      <div class="barra-movil" id="cob-movil"><button class="btn grande" id="cob-ir"></button></div>`;

    cont.querySelectorAll('.pestana').forEach(b => b.onclick = () => { Cobro.pestana = b.dataset.p; this.pintarLista(cont); });
    cont.querySelector('#cob-buscar').oninput = debounce(() => this.pintarLista(cont), 150);
    cont.querySelector('#cob-cat').onchange = () => this.pintarLista(cont);
    cont.querySelector('#cob-ir').onclick = () => cont.querySelector('#cob-ticket').scrollIntoView({ behavior: 'smooth' });

    this.pintarAvisoCaja(cont);
    UI.cargando(cont.querySelector('#cob-lista'));
    try {
      Cobro.productos = await q(sb.from('productos').select('id,nombre,precio,stock,foto_url,categoria_id,codigo')
        .eq('activo', true).eq('se_vende', true).order('nombre'));
      if (params.cita) await this.cargarCita(Number(params.cita));
    } catch (e) { UI.error(e); }
    this.pintarLista(cont);
    this.pintarTicket(cont);
  },

  pintarAvisoCaja(cont) {
    const el = cont.querySelector('#cob-caja');
    if (App.caja) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="aviso ambar mb"><i class="bi bi-lock-fill"></i>
      <span class="crece">La caja está cerrada. Para cobrar primero hay que abrirla.</span>
      <button class="btn chico" id="cob-abrir">Abrir caja</button></div>`;
    el.querySelector('#cob-abrir').onclick = async () => {
      if (await abrirCajaDialogo()) { this.pintarAvisoCaja(cont); this.pintarTicket(cont); }
    };
  },

  /* ----- Lista de la izquierda ----------------------------------------- */

  pintarLista(cont) {
    cont.querySelectorAll('.pestana').forEach(b => b.classList.toggle('activa', b.dataset.p === Cobro.pestana));
    const lista = cont.querySelector('#cob-lista');
    const filtros = cont.querySelector('#cob-filtros');
    const selCat = cont.querySelector('#cob-cat');
    const texto = cont.querySelector('#cob-buscar').value.trim().toLowerCase();

    if (Cobro.pestana === 'agenda') {
      filtros.classList.add('oculto');
      return this.pintarCitas(lista, cont);
    }
    filtros.classList.remove('oculto');
    const tipo = Cobro.pestana === 'productos' ? 'Producto' : 'Servicio';
    const cats = App.datos.categorias.filter(c => c.tipo === tipo && c.activo);
    const catActual = selCat.dataset.tipo === tipo ? selCat.value : '';
    selCat.dataset.tipo = tipo;
    selCat.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option value="${c.id}" ${String(c.id) === catActual ? 'selected' : ''}>${h(c.nombre)}</option>`).join('');
    const cat = selCat.value;

    const fuente = tipo === 'Producto' ? Cobro.productos : App.datos.servicios.filter(s => s.activo);
    const items = fuente.filter(i =>
      (!cat || String(i.categoria_id) === cat) &&
      (!texto || i.nombre.toLowerCase().includes(texto) || (i.codigo || '').toLowerCase() === texto));

    if (!items.length) { lista.innerHTML = UI.vacio('search', 'No se encontró nada. Pruebe con otra palabra.'); return; }
    lista.innerHTML = items.map((i, n) => {
      const foto = tipo === 'Producto'
        ? (i.foto_url ? `<img class="item-foto" src="${h(i.foto_url)}" alt="" loading="lazy">` : '<span class="item-foto"><i class="bi bi-bag-heart"></i></span>')
        : '<span class="item-foto"><i class="bi bi-scissors"></i></span>';
      const sub = tipo === 'Producto'
        ? (Number(i.stock) > 0 ? `Quedan ${Fmt.num(i.stock, 3)}` : '<span class="etiqueta rojo">Agotado</span>')
        : `${i.duracion_min} min · ${h(nombreDe('categorias', i.categoria_id))}`;
      const agotado = tipo === 'Producto' && Number(i.stock) <= 0;
      return `<div class="item">${foto}
        <div><div class="item-nombre">${h(i.nombre)}</div><div class="item-sub">${sub}</div></div>
        <div class="item-precio">${Fmt.L(i.precio)}</div>
        <button class="btn-redondo" data-n="${n}" aria-label="Agregar ${h(i.nombre)}" ${agotado ? 'disabled style="opacity:.35"' : ''}><i class="bi bi-plus-lg"></i></button></div>`;
    }).join('');
    lista.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
      this.agregar(tipo, items[Number(b.dataset.n)]);
      this.pintarTicket(cont);
    });
  },

  async pintarCitas(lista, cont) {
    UI.cargando(lista);
    try {
      const citas = await q(sb.from('citas')
        .select('id,hora_inicio,estado,cliente_id,servicio_id,empleado_id,cliente:clientes(id,nombre,telefono,credito_habilitado,limite_credito)')
        .eq('fecha', Fmt.hoy()).in('estado', ['Pendiente', 'Confirmada']).order('hora_inicio'));
      if (!citas.length) { lista.innerHTML = UI.vacio('calendar-check', 'No hay citas pendientes de cobro para hoy.'); return; }
      lista.innerHTML = citas.map((c, n) => `<div class="item">
        <span class="item-foto" style="font-size:1rem;font-weight:800">${Fmt.hora(c.hora_inicio)}</span>
        <div><div class="item-nombre">${h(c.cliente ? c.cliente.nombre : 'Sin cliente')}</div>
          <div class="item-sub">${h(nombreDe('servicios', c.servicio_id))} · ${h(nombreDe('empleados', c.empleado_id))}</div></div>
        <span class="etiqueta ${c.estado === 'Confirmada' ? 'verde' : ''}">${h(c.estado)}</span>
        <button class="btn-redondo" data-n="${n}" aria-label="Cobrar cita"><i class="bi bi-cart-plus"></i></button></div>`).join('');
      lista.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
        this.usarCita(citas[Number(b.dataset.n)]);
        this.pintarTicket(cont);
        UI.ok('Cita cargada en la cuenta.');
      });
    } catch (e) { lista.innerHTML = UI.vacio('exclamation-triangle', e.message); }
  },

  async cargarCita(id) {
    const c = await q(sb.from('citas')
      .select('id,hora_inicio,estado,servicio_id,empleado_id,cliente:clientes(id,nombre,telefono,credito_habilitado,limite_credito)')
      .eq('id', id).single());
    if (['Completada', 'Cancelada', 'No_Asistio'].includes(c.estado)) { UI.aviso('Esa cita ya está ' + c.estado.replace('_', ' ').toLowerCase() + '.'); return; }
    this.usarCita(c);
  },

  usarCita(c) {
    Cobro.cita = { id: c.id, hora: Fmt.hora(c.hora_inicio) };
    if (c.cliente) { Cobro.cliente = c.cliente; Cobro.credito = null; }
    const s = App.datos.servicios.find(x => x.id === c.servicio_id);
    if (s && !Cobro.lineas.some(l => l.tipo === 'Servicio' && l.item_id === s.id && String(l.empleado_id) === String(c.empleado_id))) {
      this.agregar('Servicio', s, c.empleado_id);
    }
  },

  agregar(tipo, item, empleado) {
    if (tipo === 'Producto') {
      const l = Cobro.lineas.find(x => x.tipo === 'Producto' && x.item_id === item.id);
      if (l) {
        if (l.cantidad + 1 > Number(item.stock)) return UI.aviso(`Solo quedan ${Fmt.num(item.stock, 3)} de "${item.nombre}".`);
        l.cantidad++;
        return;
      }
    }
    Cobro.lineas.push({
      tipo, item_id: item.id, nombre: item.nombre, precio: Number(item.precio), cantidad: 1, descuento_pct: 0,
      empleado_id: tipo === 'Servicio' ? (empleado || App.perfil.empleado_id || '') : '',
      stock: tipo === 'Producto' ? Number(item.stock) : null
    });
  },

  /* ----- La cuenta (derecha) ------------------------------------------- */

  pintarTicket(cont) {
    const t = cont.querySelector('#cob-ticket');
    const productos = Cobro.lineas.filter(l => l.tipo === 'Producto');
    const servicios = Cobro.lineas.filter(l => l.tipo === 'Servicio');
    const maxDesc = App.perfil.rol === 'Recepcion' ? Number(App.config.descuento_max_recepcion) : 100;

    const linea = (l) => {
      const i = Cobro.lineas.indexOf(l);
      return `<div class="linea-ticket" data-i="${i}">
        <div class="nombre">${h(l.nombre)} <span class="suave peq">${Fmt.L(l.precio)} c/u</span></div>
        <div class="importe" data-importe></div>
        <div class="controles">
          <span class="cantidad"><button data-menos aria-label="Menos">−</button><span>${Fmt.num(l.cantidad, 3)}</span><button data-mas aria-label="Más">+</button></span>
          ${l.tipo === 'Servicio' ? `<select data-emp aria-label="¿Quién lo hizo?"><option value="">¿Quién lo hizo?</option>${opcionesEmpleados(l.empleado_id)}</select>` : ''}
          <label class="desc-etq">Desc.<input class="desc" data-desc type="number" min="0" max="${maxDesc}" step="1" inputmode="decimal" value="${l.descuento_pct || ''}" placeholder="0">%</label>
          <button class="btn-icono rojo" data-quitar aria-label="Quitar"><i class="bi bi-trash3"></i></button>
        </div></div>`;
    };

    const metodos = [['Efectivo', 'cash-stack'], ['Tarjeta', 'credit-card'], ['Transferencia', 'bank'], ['Credito', 'journal-text']];

    t.innerHTML = `
      <div class="fila-entre"><h2 class="panel-titulo" style="margin:0">Cuenta</h2>
        ${Cobro.lineas.length ? '<button class="btn chico suave" id="cob-vaciar"><i class="bi bi-x-circle"></i> Vaciar</button>' : ''}</div>
      <div class="campo mt"><label>Cliente</label><div id="cob-cliente"></div></div>
      ${Cobro.cita ? `<div class="aviso azul mb"><i class="bi bi-calendar-check"></i><span class="crece">Cobrando la cita de las ${h(Cobro.cita.hora)}</span>
        <button class="btn-icono" id="cob-sin-cita" aria-label="Quitar cita"><i class="bi bi-x-lg"></i></button></div>` : ''}
      ${!Cobro.lineas.length ? UI.vacio('cart', 'La cuenta está vacía. Toque el botón + de un producto o servicio.') : ''}
      ${productos.length ? '<div class="pildora">Productos</div>' + productos.map(linea).join('') : ''}
      ${servicios.length ? '<div class="pildora">Servicios</div>' + servicios.map(linea).join('') : ''}
      ${Cobro.lineas.length ? `
        <div class="totales" id="cob-totales"></div>
        <div class="campo mt"><label>Forma de pago</label>
          <div class="opciones-pago">${metodos.map(([m, ic]) =>
            `<button class="opcion ${Cobro.metodo === m ? 'activa' : ''}" data-m="${m}"><i class="bi bi-${ic}"></i>${nombrePago(m)}</button>`).join('')}</div></div>
        <div id="cob-detalle-pago"></div>
        <button class="btn grande verde mt" id="cob-cobrar" ${App.caja ? '' : 'disabled'}><i class="bi bi-check2-circle"></i> <span></span></button>
        ${App.caja ? '' : '<p class="suave peq centro">Abra la caja para poder cobrar.</p>'}` : ''}`;

    // Cliente
    t.querySelector('#cob-cliente').appendChild(selectorCliente({
      valor: Cobro.cliente,
      onElegir: (c) => { Cobro.cliente = c; Cobro.credito = null; if (Cobro.metodo === 'Credito') this.pintarTicket(cont); }
    }));
    const sinCita = t.querySelector('#cob-sin-cita');
    if (sinCita) sinCita.onclick = () => { Cobro.cita = null; this.pintarTicket(cont); };
    const vaciar = t.querySelector('#cob-vaciar');
    if (vaciar) vaciar.onclick = async () => {
      if (await UI.confirmar('Se quitarán todos los productos y servicios de la cuenta.', { si: 'Vaciar' })) { Cobro.vaciar(); this.pintarTicket(cont); }
    };

    // Líneas
    t.querySelectorAll('.linea-ticket').forEach(div => {
      const l = Cobro.lineas[Number(div.dataset.i)];
      div.querySelector('[data-mas]').onclick = () => {
        if (l.tipo === 'Producto' && l.cantidad + 1 > l.stock) return UI.aviso(`Solo quedan ${Fmt.num(l.stock, 3)} de "${l.nombre}".`);
        l.cantidad++; this.pintarTicket(cont);
      };
      div.querySelector('[data-menos]').onclick = () => {
        if (l.cantidad > 1) l.cantidad--; else Cobro.lineas.splice(Cobro.lineas.indexOf(l), 1);
        this.pintarTicket(cont);
      };
      div.querySelector('[data-quitar]').onclick = () => { Cobro.lineas.splice(Cobro.lineas.indexOf(l), 1); this.pintarTicket(cont); };
      const emp = div.querySelector('[data-emp]');
      if (emp) emp.onchange = () => { l.empleado_id = emp.value; };
      const desc = div.querySelector('[data-desc]');
      desc.oninput = () => {
        let v = Number(desc.value) || 0;
        if (v < 0) v = 0;
        if (v > maxDesc) { v = maxDesc; desc.value = v; UI.aviso(`El descuento máximo que puede dar es ${maxDesc}%. Para más, pida a Gerencia.`); }
        l.descuento_pct = v; this.actualizarTotales(cont);
      };
    });

    // Forma de pago
    t.querySelectorAll('.opcion[data-m]').forEach(b => b.onclick = () => { Cobro.metodo = b.dataset.m; this.pintarTicket(cont); });
    if (Cobro.lineas.length) {
      this.pintarDetallePago(cont);
      t.querySelector('#cob-cobrar').onclick = () => this.cobrar(cont);
    }
    this.actualizarTotales(cont);
  },

  pintarDetallePago(cont) {
    const d = cont.querySelector('#cob-detalle-pago');
    if (Cobro.metodo === 'Efectivo') {
      d.innerHTML = `<div class="campo"><label for="cob-paga">¿Con cuánto paga? (opcional)</label>
        <input id="cob-paga" type="number" min="0" step="any" inputmode="decimal" value="${h(Cobro.pagaCon)}" placeholder="Ej. 500">
        <div class="fila mt" id="cob-rapidos"></div></div>
        <div id="cob-cambio" class="cambio"></div>`;
      const input = d.querySelector('#cob-paga');
      input.oninput = () => { Cobro.pagaCon = input.value; this.actualizarTotales(cont); };
      const { total } = Cobro.totales();
      const rapidos = [total, ...[100, 200, 500, 1000, 2000, 5000].filter(x => x > total)].slice(0, 4);
      d.querySelector('#cob-rapidos').innerHTML = rapidos.map((x, i) =>
        `<button class="btn chico suave" data-v="${x}">${i === 0 ? 'Exacto' : Fmt.L(x)}</button>`).join('');
      d.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { input.value = b.dataset.v; input.oninput(); });
    } else if (Cobro.metodo === 'Credito') {
      if (!Cobro.cliente) {
        d.innerHTML = '<div class="aviso ambar mb"><i class="bi bi-person-exclamation"></i>Para vender a crédito elija primero un cliente registrado.</div>';
        return;
      }
      if (!Cobro.credito) {
        d.innerHTML = '<div class="cargando-bloque"><span class="giro"></span></div>';
        rpc('saldo_cliente', { p_cliente: Cobro.cliente.id })
          .then(s => { Cobro.credito = s; this.pintarDetallePago(cont); this.actualizarTotales(cont); })
          .catch(e => { d.innerHTML = `<div class="aviso rojo">${h(e.message)}</div>`; });
        return;
      }
      const s = Cobro.credito;
      const estado = !s.habilitado
        ? `<div class="aviso rojo mb"><i class="bi bi-x-circle"></i>${h(Cobro.cliente.nombre)} no tiene crédito habilitado. Gerencia lo habilita en Clientes.</div>`
        : Number(s.vencido) > 0
          ? `<div class="aviso rojo mb"><i class="bi bi-exclamation-triangle"></i>Tiene ${Fmt.L(s.vencido)} vencidos. Debe ponerse al día antes de otro crédito.</div>`
          : `<div class="aviso verde mb"><i class="bi bi-check-circle"></i>Crédito disponible: <strong>${Fmt.L(s.disponible)}</strong> (debe ${Fmt.L(s.deuda)})</div>`;
      d.innerHTML = estado + `<div class="campos">
        <div class="campo"><label for="cob-prima">Prima / pago inicial (opcional)</label>
          <input id="cob-prima" type="number" min="0" step="any" inputmode="decimal" value="${h(Cobro.prima)}" placeholder="0"></div>
        <div class="campo"><label for="cob-mprima">La prima la paga con</label>
          <select id="cob-mprima">${['Efectivo', 'Tarjeta', 'Transferencia'].map(m => `<option ${Cobro.metodoPrima === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        </div><p class="suave peq" style="margin-top:-6px">Plazo para pagar: ${App.config.dias_credito} días.</p>`;
      d.querySelector('#cob-prima').oninput = (ev) => { Cobro.prima = ev.target.value; this.actualizarTotales(cont); };
      d.querySelector('#cob-mprima').onchange = (ev) => { Cobro.metodoPrima = ev.target.value; };
    } else {
      d.innerHTML = '';
    }
  },

  actualizarTotales(cont) {
    const { subtotal, descuento, total } = Cobro.totales();
    cont.querySelectorAll('.linea-ticket').forEach(div => {
      const l = Cobro.lineas[Number(div.dataset.i)];
      const bruto = redondear(l.precio * l.cantidad);
      div.querySelector('[data-importe]').textContent = Fmt.L(bruto - redondear(bruto * (Number(l.descuento_pct) || 0) / 100));
    });
    const tot = cont.querySelector('#cob-totales');
    if (tot) tot.innerHTML = `<div><span>Subtotal</span><span>${Fmt.L(subtotal)}</span></div>
      ${descuento > 0 ? `<div><span>Descuento</span><span>-${Fmt.L(descuento)}</span></div>` : ''}
      <div class="total"><span>Total</span><span>${Fmt.L(total)}</span></div>`;
    const cambio = cont.querySelector('#cob-cambio');
    if (cambio) {
      const paga = Number(Cobro.pagaCon) || 0;
      cambio.innerHTML = !paga ? '' : paga >= total
        ? `Cambio a devolver: ${Fmt.L(paga - total)}`
        : `<span style="color:var(--rojo)">Faltan ${Fmt.L(total - paga)}</span>`;
    }
    const btn = cont.querySelector('#cob-cobrar span');
    if (btn) {
      const prima = Number(Cobro.prima) || 0;
      btn.textContent = Cobro.metodo === 'Credito'
        ? `Vender a crédito ${Fmt.L(total - prima)}`
        : `Cobrar ${Fmt.L(total)}`;
    }
    const movil = cont.querySelector('#cob-movil');
    movil.classList.toggle('visible', Cobro.lineas.length > 0);
    cont.querySelector('#cob-ir').innerHTML = `<i class="bi bi-receipt"></i> Ver cuenta (${Cobro.lineas.length}) · ${Fmt.L(total)}`;
  },

  async cobrar(cont) {
    const { total } = Cobro.totales();
    try {
      if (!App.caja) throw new Error('La caja está cerrada.');
      const sinEmpleado = Cobro.lineas.find(l => l.tipo === 'Servicio' && !l.empleado_id);
      if (sinEmpleado) throw new Error(`Elija quién hizo el servicio "${sinEmpleado.nombre}".`);
      if (Cobro.metodo === 'Efectivo' && Cobro.pagaCon && Number(Cobro.pagaCon) < total) throw new Error('El dinero recibido no alcanza para el total.');
      if (Cobro.metodo === 'Credito' && !Cobro.cliente) throw new Error('Elija un cliente para vender a crédito.');
    } catch (e) { return UI.error(e); }

    const prima = Number(Cobro.prima) || 0;
    const resumen = Cobro.metodo === 'Credito'
      ? `Venta a crédito a <b>${h(Cobro.cliente.nombre)}</b> por <b>${Fmt.L(total)}</b>${prima ? `, con prima de ${Fmt.L(prima)} en ${Cobro.metodoPrima.toLowerCase()}` : ''}.`
      : `Cobrar <b>${Fmt.L(total)}</b> en <b>${nombrePago(Cobro.metodo).toLowerCase()}</b>${Cobro.cliente ? ' a ' + h(Cobro.cliente.nombre) : ''}.`;
    if (!await UI.confirmar(resumen, { titulo: 'Confirmar cobro', si: 'Sí, cobrar' })) return;

    const btn = cont.querySelector('#cob-cobrar');
    btn.disabled = true;
    try {
      const r = await rpc('registrar_venta', {
        p: {
          cliente_id: Cobro.cliente ? Cobro.cliente.id : null,
          cita_id: Cobro.cita ? Cobro.cita.id : null,
          metodo_pago: Cobro.metodo,
          paga_con: Cobro.metodo === 'Efectivo' && Cobro.pagaCon ? Number(Cobro.pagaCon) : null,
          prima: Cobro.metodo === 'Credito' && prima > 0 ? { monto: prima, metodo_pago: Cobro.metodoPrima } : null,
          lineas: Cobro.lineas.map(l => ({
            tipo: l.tipo, item_id: l.item_id, cantidad: l.cantidad,
            descuento_pct: Number(l.descuento_pct) || 0, empleado_id: l.empleado_id || null
          }))
        }
      });
      const cliente = Cobro.cliente;
      const cambio = Cobro.metodo === 'Efectivo' && Cobro.pagaCon ? Number(Cobro.pagaCon) - total : null;
      Cobro.vaciar();
      this.exito(r, cliente, cambio);
      // Stock actualizado para la siguiente venta
      Cobro.productos = await q(sb.from('productos').select('id,nombre,precio,stock,foto_url,categoria_id,codigo')
        .eq('activo', true).eq('se_vende', true).order('nombre'));
      if (App.vistaActual === 'cobrar') { this.pintarLista(cont); this.pintarTicket(cont); }
    } catch (e) {
      UI.error(e);
      btn.disabled = false;
    }
  },

  exito(r, cliente, cambio) {
    const tel = cliente && cliente.telefono;
    const cuerpo = `<div class="centro">
      <i class="bi bi-check-circle-fill" style="font-size:4rem;color:var(--verde)"></i>
      <h2 style="margin:6px 0">¡Venta registrada!</h2>
      <p class="suave">Recibo ${h(r.numero)} · Total ${Fmt.L(r.total)}</p>
      ${cambio !== null && cambio > 0 ? `<div class="aviso verde" style="justify-content:center;font-size:1.4rem">Cambio: ${Fmt.L(cambio)}</div>` : ''}
      ${Number(r.saldo) > 0 ? `<div class="aviso azul" style="justify-content:center">Queda debiendo ${Fmt.L(r.saldo)}</div>` : ''}
    </div>`;
    const botones = [
      { texto: 'Imprimir recibo', clase: 'sec', icono: 'printer', accion: () => { Impresion.venta(r.id); return false; } }
    ];
    if (tel) botones.push({
      texto: 'WhatsApp', clase: 'sec', icono: 'whatsapp', accion: async () => {
        const v = await Impresion.datosVenta(r.id);
        window.open(enlaceWhatsApp(tel, Impresion.textoVenta(v)), '_blank');
        return false;
      }
    });
    botones.push({ texto: 'Nueva venta', icono: 'plus-lg' });
    UI.modal({ titulo: '', cuerpo, botones, sinFoco: true });
  }
});
