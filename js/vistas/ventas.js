/* ==========================================================================
   Ventas: lo vendido por día o período, reimprimir recibos y anular.
   ========================================================================== */

const VentasFiltro = { desde: null, hasta: null, rapido: 'hoy' };

vista('ventas', {
  titulo: 'Ventas', icono: 'receipt', roles: MOSTRADOR,
  async render(cont) {
    if (!VentasFiltro.desde) this.rango('hoy');
    const rapidos = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['mes', 'Este mes']];
    cont.innerHTML = `
      <div class="barra-herramientas">
        ${rapidos.map(([k, t]) => `<button class="pestana ${VentasFiltro.rapido === k ? 'activa' : ''}" data-r="${k}">${t}</button>`).join('')}
        <input type="date" id="vt-desde" value="${VentasFiltro.desde}" style="width:auto" aria-label="Desde">
        <input type="date" id="vt-hasta" value="${VentasFiltro.hasta}" style="width:auto" aria-label="Hasta">
      </div>
      <div id="vt-kpis"></div>
      <div class="panel"><div class="barra-herramientas">
        <div class="buscador"><i class="bi bi-search"></i><input type="search" id="vt-buscar" placeholder="Buscar por número de recibo o cliente…"></div>
      </div><div id="vt-lista"></div></div>`;
    cont.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { this.rango(b.dataset.r); this.render(cont); });
    const cambioFecha = () => {
      VentasFiltro.desde = cont.querySelector('#vt-desde').value || Fmt.hoy();
      VentasFiltro.hasta = cont.querySelector('#vt-hasta').value || VentasFiltro.desde;
      VentasFiltro.rapido = '';
      this.render(cont);
    };
    cont.querySelector('#vt-desde').onchange = cambioFecha;
    cont.querySelector('#vt-hasta').onchange = cambioFecha;

    UI.cargando(cont.querySelector('#vt-lista'));
    const [desdeTs, hastaTs] = Fmt.rangoDias(VentasFiltro.desde, VentasFiltro.hasta);
    const [r, ventas] = await Promise.all([
      rpc('resumen_ventas', { p_desde: VentasFiltro.desde, p_hasta: VentasFiltro.hasta }),
      q(sb.from('ventas').select('id,numero,fecha,total,metodo_pago,estado,saldo_pendiente,cliente:clientes(nombre),usuario:perfiles!ventas_usuario_id_fkey(nombre)')
        .gte('fecha', desdeTs).lt('fecha', hastaTs).order('fecha', { ascending: false }).limit(1000))
    ]);
    cont.querySelector('#vt-kpis').innerHTML = `<div class="kpis">
      <div class="kpi vino"><small>Total vendido</small><strong>${Fmt.L(r.total)}</strong></div>
      <div class="kpi"><small>Ventas</small><strong>${r.cantidad}${r.anuladas ? ` <span class="peq suave">(${r.anuladas} anuladas)</span>` : ''}</strong></div>
      <div class="kpi"><small>Efectivo</small><strong>${Fmt.L(r.efectivo)}</strong></div>
      <div class="kpi"><small>Tarjeta</small><strong>${Fmt.L(r.tarjeta)}</strong></div>
      <div class="kpi"><small>Transferencia</small><strong>${Fmt.L(r.transferencia)}</strong></div>
      <div class="kpi"><small>A crédito</small><strong>${Fmt.L(r.credito)}</strong></div>
      <div class="kpi verde"><small>Abonos recibidos</small><strong>${Fmt.L(r.abonos)}</strong></div>
    </div>`;

    const pintar = () => {
      const t = cont.querySelector('#vt-buscar').value.trim().toLowerCase();
      const filas = ventas.filter(v => !t || v.numero.toLowerCase().includes(t) || (v.cliente && v.cliente.nombre.toLowerCase().includes(t)));
      const lista = cont.querySelector('#vt-lista');
      if (!filas.length) { lista.innerHTML = UI.vacio('receipt', 'No hay ventas en este período.'); return; }
      lista.innerHTML = `<div class="tabla-envoltura"><table class="tabla apilable">
        <thead><tr><th>Recibo</th><th>Fecha</th><th>Cliente</th><th>Pago</th><th>Atendió</th><th class="num">Total</th></tr></thead>
        <tbody>${filas.map((v, i) => `<tr class="clic ${v.estado === 'Anulada' ? 'anulada' : ''}" data-i="${i}">
          <td data-t="Recibo"><strong>${h(v.numero)}</strong></td>
          <td data-t="Fecha">${Fmt.fechaHora(v.fecha)}</td>
          <td data-t="Cliente">${h(v.cliente ? v.cliente.nombre : 'Mostrador')}</td>
          <td data-t="Pago">${v.estado === 'Anulada' ? '<span class="etiqueta rojo">Anulada</span>' : h(nombrePago(v.metodo_pago))}
            ${v.metodo_pago === 'Credito' && v.estado === 'Emitida' && Number(v.saldo_pendiente) > 0 ? '<span class="etiqueta ambar">Debe</span>' : ''}</td>
          <td data-t="Atendió">${h(v.usuario ? v.usuario.nombre : '')}</td>
          <td class="num" data-t="Total"><strong>${Fmt.L(v.total)}</strong></td></tr>`).join('')}</tbody></table></div>`;
      lista.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => detalleVenta(filas[Number(tr.dataset.i)].id, () => this.render(cont)));
    };
    cont.querySelector('#vt-buscar').oninput = debounce(pintar, 150);
    pintar();
  },

  rango(k) {
    const hoy = Fmt.hoy();
    const d = new Date();
    VentasFiltro.rapido = k;
    if (k === 'hoy') { VentasFiltro.desde = VentasFiltro.hasta = hoy; }
    if (k === 'ayer') { VentasFiltro.desde = VentasFiltro.hasta = Fmt.sumarDias(hoy, -1); }
    if (k === 'semana') { VentasFiltro.desde = Fmt.sumarDias(hoy, -((d.getDay() + 6) % 7)); VentasFiltro.hasta = hoy; }
    if (k === 'mes') { VentasFiltro.desde = hoy.slice(0, 8) + '01'; VentasFiltro.hasta = hoy; }
  }
});

/** Ventana con el detalle de una venta. La usan Ventas, Clientes y Créditos. */
async function detalleVenta(id, alCambiar) {
  try {
    const v = await Impresion.datosVenta(id);
    const cuerpo = `
      <div class="fila-entre mb"><div><strong style="font-size:1.2rem">${h(v.numero)}</strong><div class="suave">${Fmt.fechaHora(v.fecha)}</div></div>
        ${v.estado === 'Anulada' ? '<span class="etiqueta rojo">ANULADA</span>' : `<span class="etiqueta">${h(nombrePago(v.metodo_pago))}</span>`}</div>
      <div class="lista-def mb">
        <div><span>Cliente</span><span>${h(v.cliente ? v.cliente.nombre : 'Cliente de mostrador')}</span></div>
        <div><span>Atendió</span><span>${h(v.usuario ? v.usuario.nombre : '')}</span></div>
      </div>
      <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Detalle</th><th class="num">Cant.</th><th class="num">Importe</th></tr></thead><tbody>
        ${v.lineas.map(l => `<tr><td>${h(l.descripcion)}<div class="suave peq">${l.empleado ? h(l.empleado.nombre) : ''}${Number(l.descuento) > 0 ? ` · desc. ${Fmt.num(l.descuento_pct)}%` : ''}</div></td>
          <td class="num">${Fmt.num(l.cantidad, 3)}</td><td class="num">${Fmt.L(l.importe)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="totales">
        <div><span>Subtotal</span><span>${Fmt.L(v.subtotal)}</span></div>
        ${Number(v.descuento) > 0 ? `<div><span>Descuento</span><span>-${Fmt.L(v.descuento)}</span></div>` : ''}
        <div class="total"><span>Total</span><span>${Fmt.L(v.total)}</span></div>
        ${v.metodo_pago === 'Credito' && v.estado === 'Emitida' ? `<div><span>Saldo pendiente</span><span>${Fmt.L(v.saldo_pendiente)}</span></div>
          <div><span>Vence</span><span>${Fmt.fecha(v.fecha_vencimiento)}</span></div>` : ''}
      </div>
      ${v.estado === 'Anulada' ? `<div class="aviso rojo mt"><i class="bi bi-x-octagon"></i>Anulada: ${h(v.motivo_anulacion)}</div>` : ''}`;
    const botones = [{ texto: 'Imprimir', clase: 'sec', icono: 'printer', accion: () => { Impresion.venta(id); return false; } }];
    if (v.cliente && v.cliente.telefono) botones.push({
      texto: 'WhatsApp', clase: 'sec', icono: 'whatsapp',
      accion: () => { window.open(enlaceWhatsApp(v.cliente.telefono, Impresion.textoVenta(v)), '_blank'); return false; }
    });
    if (v.estado === 'Emitida' && puede(GERENCIA)) botones.push({
      texto: 'Anular', clase: 'peligro', icono: 'x-octagon', accion: async () => {
        const r = await UI.pedir('Anular venta ' + v.numero, [
          { n: 'motivo', t: '¿Por qué se anula?', req: true, ancho: true, ayuda: 'Los productos regresan al inventario. Si fue en efectivo, devuelva el dinero de la gaveta.' }
        ], { boton: 'Anular venta' });
        if (!r) return false;
        await rpc('anular_venta', { p_venta: id, p_motivo: r.motivo });
        UI.ok('Venta anulada.');
        alCambiar && alCambiar();
      }
    });
    UI.modal({ titulo: 'Detalle de venta', cuerpo, botones, sinFoco: true });
  } catch (e) { UI.error(e); }
}
