/* ==========================================================================
   Clientes: buscar, registrar, ver historial y (Gerencia) dar crédito.
   ========================================================================== */

const CAMPOS_CLIENTE = [
  { n: 'nombre', t: 'Nombre completo', req: true, ancho: true },
  { n: 'telefono', t: 'Teléfono / WhatsApp', tipo: 'tel', inputmode: 'tel' },
  { n: 'email', t: 'Correo', tipo: 'email' },
  { n: 'fecha_nacimiento', t: 'Cumpleaños', tipo: 'date' },
  { n: 'notas', t: 'Notas y preferencias', tipo: 'textarea', ph: 'Ej. alérgica al amoníaco, prefiere a Carla' }
];

vista('clientes', {
  titulo: 'Clientes', icono: 'person-hearts', roles: TODOS,
  async render(cont) {
    const editable = puede(MOSTRADOR);
    cont.innerHTML = `
      <div class="barra-herramientas">
        <div class="buscador"><i class="bi bi-search"></i><input type="search" id="cl-buscar" placeholder="Buscar por nombre o teléfono…"></div>
        <select id="cl-filtro"><option value="">Todos</option><option value="cumple">Cumpleañeros del mes</option>
          <option value="credito">Con crédito</option><option value="inactivos">Desactivados</option></select>
        ${editable ? '<button class="btn" id="cl-nuevo"><i class="bi bi-person-plus"></i> Nuevo cliente</button>' : ''}
      </div>
      <div class="panel" id="cl-lista"></div>`;
    const recargar = () => this.buscar(cont);
    cont.querySelector('#cl-buscar').oninput = debounce(recargar, 250);
    cont.querySelector('#cl-filtro').onchange = recargar;
    if (editable) cont.querySelector('#cl-nuevo').onclick = () => this.formulario(null, recargar);
    recargar();
  },

  async buscar(cont) {
    const lista = cont.querySelector('#cl-lista');
    const t = limpiarBusqueda(cont.querySelector('#cl-buscar').value);
    const filtro = cont.querySelector('#cl-filtro').value;
    let consulta = sb.from('clientes').select('*').order('nombre').limit(300);
    consulta = consulta.eq('activo', filtro !== 'inactivos');
    if (filtro === 'credito') consulta = consulta.eq('credito_habilitado', true);
    if (t) consulta = consulta.or(`nombre.ilike.%${t}%,telefono.ilike.%${t}%`);
    try {
      let filas = await q(consulta);
      if (filtro === 'cumple') {
        const mes = new Date().getMonth() + 1;
        filas = filas.filter(c => c.fecha_nacimiento && Number(c.fecha_nacimiento.slice(5, 7)) === mes)
          .sort((a, b) => a.fecha_nacimiento.slice(8).localeCompare(b.fecha_nacimiento.slice(8)));
      }
      if (!filas.length) { lista.innerHTML = UI.vacio('people', 'No se encontraron clientes.'); return; }
      lista.innerHTML = `<div class="tabla-envoltura"><table class="tabla apilable">
        <thead><tr><th>Nombre</th><th>Teléfono</th><th>Cumpleaños</th><th>Última visita</th><th class="num">Visitas</th><th></th></tr></thead>
        <tbody>${filas.map((c, i) => `<tr class="clic" data-i="${i}">
          <td data-t="Nombre"><strong>${h(c.nombre)}</strong></td>
          <td data-t="Teléfono">${h(c.telefono || '—')}</td>
          <td data-t="Cumpleaños">${c.fecha_nacimiento ? h(Fmt.aFecha(c.fecha_nacimiento).toLocaleDateString('es-HN', { day: 'numeric', month: 'long' })) : '—'}</td>
          <td data-t="Última visita">${c.ultima_visita ? Fmt.fecha(c.ultima_visita) : '—'}</td>
          <td class="num" data-t="Visitas">${c.total_visitas}</td>
          <td class="sin-t der">${c.credito_habilitado ? '<span class="etiqueta azul">Crédito</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
      lista.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => this.ficha(filas[Number(tr.dataset.i)], () => this.buscar(cont)));
    } catch (e) { lista.innerHTML = UI.vacio('exclamation-triangle', e.message); }
  },

  /** Ficha del cliente con historial. */
  async ficha(c, recargar) {
    const verVentas = puede(MOSTRADOR);
    const [citas, ventas] = await Promise.all([
      q(sb.from('citas').select('fecha,hora_inicio,servicio_id,empleado_id,estado').eq('cliente_id', c.id).order('fecha', { ascending: false }).limit(15)),
      verVentas ? q(sb.from('ventas').select('id,numero,fecha,total,metodo_pago,estado').eq('cliente_id', c.id).order('fecha', { ascending: false }).limit(15)) : []
    ]).catch(e => { UI.error(e); return [[], []]; });

    const cuerpo = `
      <div class="lista-def">
        <div><span>Teléfono</span><span>${h(c.telefono || '—')}</span></div>
        ${c.email ? `<div><span>Correo</span><span>${h(c.email)}</span></div>` : ''}
        <div><span>Cumpleaños</span><span>${c.fecha_nacimiento ? Fmt.fecha(c.fecha_nacimiento) : '—'}</span></div>
        <div><span>Visitas</span><span>${c.total_visitas}${c.ultima_visita ? ' · última ' + Fmt.fecha(c.ultima_visita) : ''}</span></div>
        <div><span>Crédito</span><span>${c.credito_habilitado ? 'Sí, límite ' + Fmt.L(c.limite_credito) : 'No'}</span></div>
        ${c.notas ? `<div><span>Notas</span><span style="font-weight:600">${h(c.notas)}</span></div>` : ''}
      </div>
      ${verVentas ? `<div class="pildora">Últimas compras</div>
        ${ventas.length ? `<table class="tabla">${ventas.map(v => `<tr class="clic ${v.estado === 'Anulada' ? 'anulada' : ''}" data-v="${v.id}">
          <td>${Fmt.fecha(v.fecha)}</td><td>${h(v.numero)}</td><td>${h(nombrePago(v.metodo_pago))}</td><td class="num">${Fmt.L(v.total)}</td></tr>`).join('')}</table>`
          : '<p class="suave">Todavía no tiene compras.</p>'}` : ''}
      <div class="pildora">Últimas citas</div>
      ${citas.length ? `<table class="tabla">${citas.map(x => `<tr>
        <td>${Fmt.fecha(x.fecha)} ${Fmt.hora(x.hora_inicio)}</td><td>${h(nombreDe('servicios', x.servicio_id))}</td>
        <td>${h(nombreDe('empleados', x.empleado_id))}</td><td><span class="etiqueta ${ESTADOS_CITA[x.estado][0]}">${ESTADOS_CITA[x.estado][1]}</span></td></tr>`).join('')}</table>`
        : '<p class="suave">Sin citas.</p>'}`;

    const botones = [];
    if (c.telefono) botones.push({ texto: 'WhatsApp', clase: 'sec', icono: 'whatsapp', accion: () => { window.open(enlaceWhatsApp(c.telefono, `Hola ${c.nombre}, `), '_blank'); return false; } });
    if (puede(GERENCIA)) botones.push({ texto: 'Crédito', clase: 'sec', icono: 'journal-text', accion: async () => { if (await this.credito(c)) recargar(); } });
    if (puede(MOSTRADOR)) botones.push({ texto: 'Editar', icono: 'pencil', accion: () => this.formulario(c, recargar) });
    if (!botones.length) botones.push({ texto: 'Cerrar', clase: 'sec' });
    const m = UI.modal({ titulo: c.nombre, cuerpo, botones, ancho: true, sinFoco: true });
    m.cuerpo.querySelectorAll('tr[data-v]').forEach(tr => tr.onclick = () => detalleVenta(Number(tr.dataset.v)));
  },

  formulario(c, recargar) {
    const nuevo = !c;
    const campos = nuevo ? CAMPOS_CLIENTE : [...CAMPOS_CLIENTE, { n: 'activo', t: 'Cliente activo', tipo: 'check' }];
    UI.modal({
      titulo: nuevo ? 'Nuevo cliente' : 'Editar cliente',
      cuerpo: Form.html(campos, c || { activo: true }),
      botones: [
        { texto: 'Cancelar', clase: 'sec' },
        {
          texto: 'Guardar', icono: 'check2', accion: async (m) => {
            const v = Form.leer(m.cuerpo, campos);
            v.fecha_nacimiento = v.fecha_nacimiento || null;
            if (nuevo) await q(sb.from('clientes').insert(v));
            else await q(sb.from('clientes').update(v).eq('id', c.id));
            UI.ok('Cliente guardado.');
            recargar();
          }
        }
      ]
    });
  },

  async credito(c) {
    const v = await UI.pedir('Crédito de ' + c.nombre, [
      { n: 'habilitado', t: 'Puede comprar a crédito', tipo: 'check' },
      { n: 'limite', t: 'Límite de crédito (L)', tipo: 'number', min: 0, inputmode: 'decimal', ancho: true,
        ayuda: `Lo máximo que puede deber. Plazo de pago: ${App.config.dias_credito} días.` }
    ], { valores: { habilitado: c.credito_habilitado, limite: c.limite_credito }, boton: 'Guardar' });
    if (!v) return false;
    try {
      await rpc('configurar_credito', { p_cliente: c.id, p_habilitado: v.habilitado, p_limite: v.limite || 0 });
      UI.ok('Crédito actualizado.');
      return true;
    } catch (e) { UI.error(e); return false; }
  }
});
