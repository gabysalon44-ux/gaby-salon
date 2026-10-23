/* ==========================================================================
   Créditos: quién debe, cuánto, qué está vencido y registro de abonos.
   ========================================================================== */

vista('creditos', {
  titulo: 'Créditos', icono: 'journal-text', roles: MOSTRADOR,
  async render(cont) {
    UI.cargando(cont);
    const r = await rpc('resumen_creditos');
    const conSaldo = r.clientes.filter(c => Number(c.saldo) > 0);
    cont.innerHTML = `
      <div class="kpis">
        <div class="kpi vino"><small>Total por cobrar</small><strong>${Fmt.L(r.por_cobrar)}</strong></div>
        <div class="kpi rojo"><small>Vencido</small><strong>${Fmt.L(r.vencido)}</strong></div>
        <div class="kpi"><small>Clientes que deben</small><strong>${conSaldo.length}</strong></div>
      </div>
      <div class="panel">
        <div class="barra-herramientas">
          <div class="buscador"><i class="bi bi-search"></i><input type="search" id="cr-buscar" placeholder="Buscar cliente…"></div>
          <label class="check" style="margin:0"><input type="checkbox" id="cr-todos"> Ver también clientes sin deuda</label>
        </div>
        <div id="cr-lista"></div>
      </div>`;
    const pintar = () => {
      const t = cont.querySelector('#cr-buscar').value.trim().toLowerCase();
      const todos = cont.querySelector('#cr-todos').checked;
      const filas = (todos ? r.clientes : conSaldo).filter(c => !t || c.nombre.toLowerCase().includes(t));
      const lista = cont.querySelector('#cr-lista');
      if (!filas.length) { lista.innerHTML = UI.vacio('emoji-smile', todos ? 'No hay clientes con crédito.' : 'Nadie debe. ¡Excelente!'); return; }
      lista.innerHTML = `<div class="tabla-envoltura"><table class="tabla apilable">
        <thead><tr><th>Cliente</th><th>Teléfono</th><th class="num">Debe</th><th class="num">Vencido</th><th>Próximo vencimiento</th><th class="num">Límite</th></tr></thead>
        <tbody>${filas.map((c, i) => `<tr class="clic" data-i="${i}">
          <td data-t="Cliente"><strong>${h(c.nombre)}</strong></td>
          <td data-t="Teléfono">${h(c.telefono || '')}</td>
          <td class="num" data-t="Debe"><strong>${Fmt.L(c.saldo)}</strong></td>
          <td class="num" data-t="Vencido">${Number(c.vencido) > 0 ? `<span class="etiqueta rojo">${Fmt.L(c.vencido)}</span>` : '—'}</td>
          <td data-t="Próximo vencimiento">${c.proximo_vencimiento ? Fmt.fecha(c.proximo_vencimiento) : '—'}</td>
          <td class="num" data-t="Límite">${c.habilitado ? Fmt.L(c.limite) : '<span class="etiqueta gris">Sin crédito</span>'}</td></tr>`).join('')}</tbody></table></div>`;
      lista.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => cuentaCliente(filas[Number(tr.dataset.i)].id, () => this.render(cont)));
    };
    cont.querySelector('#cr-buscar').oninput = debounce(pintar, 150);
    cont.querySelector('#cr-todos').onchange = pintar;
    pintar();
  }
});

/** Estado de cuenta de un cliente: ventas a crédito, abonos y botón para abonar. */
async function cuentaCliente(idCliente, alCambiar) {
  try {
    const [cl, s, ventas, abonos] = await Promise.all([
      q(sb.from('clientes').select('*').eq('id', idCliente).single()),
      rpc('saldo_cliente', { p_cliente: idCliente }),
      q(sb.from('ventas').select('id,numero,fecha,total,saldo_pendiente,estado,estado_credito,fecha_vencimiento')
        .eq('cliente_id', idCliente).eq('metodo_pago', 'Credito').order('fecha', { ascending: false }).limit(100)),
      q(sb.from('abonos').select('id,numero,fecha,monto,metodo_pago,estado,motivo_anulacion,venta:ventas(numero),usuario:perfiles!abonos_usuario_id_fkey(nombre)')
        .eq('cliente_id', idCliente).order('fecha', { ascending: false }).limit(100))
    ]);
    const hoy = Fmt.hoy();
    const pendientes = ventas.filter(v => v.estado === 'Emitida' && v.estado_credito === 'Pendiente');

    const cuerpo = document.createElement('div');
    cuerpo.innerHTML = `
      <div class="kpis">
        <div class="kpi vino"><small>Debe</small><strong>${Fmt.L(s.deuda)}</strong></div>
        <div class="kpi ${Number(s.vencido) > 0 ? 'rojo' : ''}"><small>Vencido</small><strong>${Fmt.L(s.vencido)}</strong></div>
        <div class="kpi"><small>Disponible</small><strong>${s.habilitado ? Fmt.L(s.disponible) : '—'}</strong></div>
      </div>
      <div class="pildora">Ventas a crédito</div>
      ${ventas.length ? `<div class="tabla-envoltura"><table class="tabla apilable"><thead><tr><th>Venta</th><th>Fecha</th><th>Vence</th><th class="num">Total</th><th class="num">Saldo</th></tr></thead><tbody>
        ${ventas.map(v => {
          const vencida = v.estado === 'Emitida' && Number(v.saldo_pendiente) > 0 && v.fecha_vencimiento < hoy;
          const est = v.estado === 'Anulada' ? '<span class="etiqueta gris">Anulada</span>'
            : v.estado_credito === 'Pagada' ? '<span class="etiqueta verde">Pagada</span>'
              : vencida ? `<span class="etiqueta rojo">${Fmt.L(v.saldo_pendiente)}</span>` : Fmt.L(v.saldo_pendiente);
          return `<tr class="clic" data-v="${v.id}"><td data-t="Venta"><strong>${h(v.numero)}</strong></td><td data-t="Fecha">${Fmt.fecha(v.fecha)}</td>
            <td data-t="Vence">${Fmt.fecha(v.fecha_vencimiento)}</td><td class="num" data-t="Total">${Fmt.L(v.total)}</td><td class="num" data-t="Saldo">${est}</td></tr>`;
        }).join('')}</tbody></table></div>` : UI.vacio('journal', 'Sin ventas a crédito.')}
      <div class="pildora">Abonos</div>
      ${abonos.length ? `<div class="tabla-envoltura"><table class="tabla apilable"><thead><tr><th>Comprobante</th><th>Fecha</th><th>Venta</th><th>Pago</th><th class="num">Monto</th><th></th></tr></thead><tbody>
        ${abonos.map(a => `<tr class="${a.estado === 'Anulado' ? 'anulada' : ''}">
          <td data-t="Comprobante">${h(a.numero)}</td><td data-t="Fecha">${Fmt.fechaHora(a.fecha)}</td>
          <td data-t="Venta">${h(a.venta ? a.venta.numero : '')}</td><td data-t="Pago">${h(nombrePago(a.metodo_pago))}</td>
          <td class="num" data-t="Monto">${Fmt.L(a.monto)}</td>
          <td class="sin-t der"><button class="btn-icono" data-imp="${h(a.numero)}" aria-label="Imprimir"><i class="bi bi-printer"></i></button>
            ${a.estado === 'Aplicado' && puede(GERENCIA) ? `<button class="btn-icono rojo" data-anular="${a.id}" aria-label="Anular abono"><i class="bi bi-x-lg"></i></button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : UI.vacio('cash', 'Sin abonos.')}`;

    const botones = [];
    if (cl.telefono && Number(s.deuda) > 0) botones.push({
      texto: 'Recordar saldo', clase: 'sec', icono: 'whatsapp', accion: () => {
        const msg = `Hola ${cl.nombre}, le saludamos de ${App.config.nombre_negocio}. Le recordamos que tiene un saldo pendiente de ${Fmt.L(s.deuda)}` +
          (Number(s.vencido) > 0 ? `, de los cuales ${Fmt.L(s.vencido)} ya están vencidos` : '') + '. ¡Muchas gracias!';
        window.open(enlaceWhatsApp(cl.telefono, msg), '_blank');
        return false;
      }
    });
    if (pendientes.length) botones.push({
      texto: 'Registrar abono', icono: 'cash-coin', accion: async (m) => {
        if (await registrarAbono(cl, pendientes, s)) { m.cerrar(); alCambiar && alCambiar(); }
        return false;
      }
    });
    if (!botones.length) botones.push({ texto: 'Cerrar', clase: 'sec' });
    const m = UI.modal({ titulo: cl.nombre, cuerpo, botones, ancho: true, sinFoco: true });

    cuerpo.querySelectorAll('tr[data-v]').forEach(tr => tr.onclick = () => detalleVenta(Number(tr.dataset.v), () => { m.cerrar(); alCambiar && alCambiar(); }));
    cuerpo.querySelectorAll('[data-imp]').forEach(b => b.onclick = () => Impresion.abono(b.dataset.imp));
    cuerpo.querySelectorAll('[data-anular]').forEach(b => b.onclick = async () => {
      const r = await UI.pedir('Anular abono', [{ n: 'motivo', t: '¿Por qué se anula?', req: true, ancho: true,
        ayuda: 'El saldo vuelve a la venta. Si fue en efectivo, el dinero sale de la caja abierta.' }], { boton: 'Anular abono' });
      if (!r) return;
      try {
        await rpc('anular_abono', { p_abono: Number(b.dataset.anular), p_motivo: r.motivo });
        UI.ok('Abono anulado.');
        m.cerrar(); alCambiar && alCambiar();
      } catch (e) { UI.error(e); }
    });
  } catch (e) { UI.error(e); }
}

/** Pide los datos del abono y lo registra. Devuelve true si se registró. */
async function registrarAbono(cl, pendientes, s) {
  if (!App.caja) {
    UI.aviso('La caja está cerrada. Ábrala para recibir el abono.');
    if (!await abrirCajaDialogo()) return false;
  }
  const v = await UI.pedir('Abono de ' + cl.nombre, [
    { n: 'monto', t: `Monto (debe ${Fmt.L(s.deuda)})`, tipo: 'number', req: true, min: 0.01, inputmode: 'decimal' },
    { n: 'metodo_pago', t: 'Forma de pago', tipo: 'select', op: [['Efectivo', 'Efectivo'], ['Tarjeta', 'Tarjeta'], ['Transferencia', 'Transferencia']] },
    { n: 'venta_id', t: 'Aplicar a', tipo: 'select', ancho: true,
      op: [['', 'Las ventas más antiguas primero'], ...pendientes.map(x => [x.id, `${x.numero} — debe ${Fmt.L(x.saldo_pendiente)}`])] },
    { n: 'nota', t: 'Nota (opcional)', ancho: true }
  ], { boton: 'Registrar abono' });
  if (!v) return false;
  try {
    const r = await rpc('registrar_abono', { p: { cliente_id: cl.id, venta_id: v.venta_id || null, monto: v.monto, metodo_pago: v.metodo_pago, nota: v.nota } });
    UI.modal({
      titulo: '', sinFoco: true,
      cuerpo: `<div class="centro"><i class="bi bi-check-circle-fill" style="font-size:4rem;color:var(--verde)"></i>
        <h2 style="margin:6px 0">Abono registrado</h2><p class="suave">Comprobante ${h(r.numero)} · ${Fmt.L(r.monto)}</p></div>`,
      botones: [
        { texto: 'Imprimir comprobante', clase: 'sec', icono: 'printer', accion: () => { Impresion.abono(r.numero); return false; } },
        { texto: 'Listo' }
      ]
    });
    return true;
  } catch (e) { UI.error(e); return false; }
}
