/* ==========================================================================
   Recibos para impresora térmica de 80 mm (también salen bien en hoja carta)
   y texto para enviarlos por WhatsApp.
   ========================================================================== */

const Impresion = {
  /** Trae todo lo necesario de una venta. */
  async datosVenta(id) {
    const v = await q(sb.from('ventas')
      .select('*, cliente:clientes(nombre,telefono), usuario:perfiles!ventas_usuario_id_fkey(nombre)')
      .eq('id', id).single());
    v.lineas = await q(sb.from('ventas_detalle').select('*, empleado:empleados(nombre)').eq('venta_id', id).order('id'));
    v.abonos = v.metodo_pago === 'Credito'
      ? await q(sb.from('abonos').select('*').eq('venta_id', id).eq('estado', 'Aplicado').order('fecha')) : [];
    return v;
  },

  async venta(id) {
    try {
      const v = await this.datosVenta(id);
      const c = App.config;
      const filas = v.lineas.map(l => `
        <tr><td>${h(l.descripcion)}${l.empleado ? `<div class="quien">${h(l.empleado.nombre)}</div>` : ''}
          ${Number(l.descuento) > 0 ? `<div class="quien">Desc. ${Fmt.num(l.descuento_pct)}%: -${Fmt.L(l.descuento)}</div>` : ''}</td>
        <td class="num">${Fmt.num(l.cantidad, 3)}</td><td class="num">${Fmt.L(l.importe)}</td></tr>`).join('');
      const credito = v.metodo_pago === 'Credito' ? `
        <div class="fila"><span>Abonado</span><span>${Fmt.L(v.total - v.saldo_pendiente)}</span></div>
        <div class="fila fuerte"><span>Saldo pendiente</span><span>${Fmt.L(v.saldo_pendiente)}</span></div>
        <div class="fila"><span>Vence</span><span>${Fmt.fecha(v.fecha_vencimiento)}</span></div>` : '';
      const efectivo = v.metodo_pago === 'Efectivo' && v.paga_con ? `
        <div class="fila"><span>Pagó con</span><span>${Fmt.L(v.paga_con)}</span></div>
        <div class="fila"><span>Cambio</span><span>${Fmt.L(v.paga_con - v.total)}</span></div>` : '';
      this.imprimir(`
        ${this.encabezado(v.estado === 'Anulada' ? 'VENTA ANULADA' : 'Recibo de venta', v.numero)}
        <div class="meta">
          <div class="fila"><span>Fecha</span><span>${Fmt.fechaHora(v.fecha)}</span></div>
          <div class="fila"><span>Cliente</span><span>${h(v.cliente ? v.cliente.nombre : 'Cliente de mostrador')}</span></div>
          <div class="fila"><span>Atendió</span><span>${h(v.usuario ? v.usuario.nombre : '')}</span></div>
        </div>
        <table><thead><tr><th>Detalle</th><th class="num">Cant.</th><th class="num">Importe</th></tr></thead><tbody>${filas}</tbody></table>
        <div class="totales">
          <div class="fila"><span>Subtotal</span><span>${Fmt.L(v.subtotal)}</span></div>
          ${Number(v.descuento) > 0 ? `<div class="fila"><span>Descuento</span><span>-${Fmt.L(v.descuento)}</span></div>` : ''}
          <div class="fila total"><span>TOTAL</span><span>${Fmt.L(v.total)}</span></div>
          <div class="fila"><span>Forma de pago</span><span>${h(nombrePago(v.metodo_pago))}</span></div>
          ${efectivo}${credito}
        </div>
        ${v.estado === 'Anulada' ? `<p class="anulado">ANULADA: ${h(v.motivo_anulacion)}</p>` : ''}
        <p class="pie">${h(c.mensaje_recibo || '')}</p>`);
    } catch (e) { UI.error(e); }
  },

  textoVenta(v) {
    const lineas = v.lineas.map(l => `• ${l.descripcion}${Number(l.cantidad) !== 1 ? ' x' + Fmt.num(l.cantidad, 3) : ''}: ${Fmt.L(l.importe)}`).join('\n');
    let t = `*${App.config.nombre_negocio}*\nRecibo ${v.numero} — ${Fmt.fechaHora(v.fecha)}\n\n${lineas}\n\n`;
    if (Number(v.descuento) > 0) t += `Descuento: -${Fmt.L(v.descuento)}\n`;
    t += `*Total: ${Fmt.L(v.total)}*\nPago: ${nombrePago(v.metodo_pago)}\n`;
    if (v.metodo_pago === 'Credito') t += `Saldo pendiente: ${Fmt.L(v.saldo_pendiente)} (vence ${Fmt.fecha(v.fecha_vencimiento)})\n`;
    return t + `\n${App.config.mensaje_recibo || ''}`;
  },

  async abono(numero) {
    try {
      const filas = await q(sb.from('abonos')
        .select('*, venta:ventas(numero), cliente:clientes(nombre,telefono), usuario:perfiles!abonos_usuario_id_fkey(nombre)')
        .eq('numero', numero).order('id'));
      if (!filas.length) throw new Error('Comprobante no encontrado.');
      const a = filas[0];
      const aplicado = filas.filter(x => x.estado === 'Aplicado').reduce((s, x) => s + Number(x.monto), 0);
      const saldo = await rpc('saldo_cliente', { p_cliente: a.cliente_id });
      this.imprimir(`
        ${this.encabezado(filas.every(x => x.estado === 'Anulado') ? 'ABONO ANULADO' : 'Comprobante de abono', numero)}
        <div class="meta">
          <div class="fila"><span>Fecha</span><span>${Fmt.fechaHora(a.fecha)}</span></div>
          <div class="fila"><span>Cliente</span><span>${h(a.cliente ? a.cliente.nombre : '')}</span></div>
          <div class="fila"><span>Forma de pago</span><span>${h(nombrePago(a.metodo_pago))}</span></div>
          <div class="fila"><span>Recibió</span><span>${h(a.usuario ? a.usuario.nombre : '')}</span></div>
        </div>
        <table><thead><tr><th>Venta</th><th class="num">Abono</th><th class="num">Saldo</th></tr></thead><tbody>
        ${filas.map(x => `<tr${x.estado === 'Anulado' ? ' class="tachado"' : ''}><td>${h(x.venta ? x.venta.numero : '')}</td>
          <td class="num">${Fmt.L(x.monto)}</td><td class="num">${Fmt.L(x.saldo_nuevo)}</td></tr>`).join('')}
        </tbody></table>
        <div class="totales">
          <div class="fila total"><span>ABONADO</span><span>${Fmt.L(aplicado)}</span></div>
          <div class="fila fuerte"><span>Saldo total del cliente</span><span>${Fmt.L(saldo.deuda)}</span></div>
        </div>
        <p class="pie">${h(App.config.mensaje_recibo || '')}</p>`);
    } catch (e) { UI.error(e); }
  },

  encabezado(tipo, numero) {
    const c = App.config;
    return `<div class="encabezado">
      <img src="${new URL('img/logo.png', location.href).href}" alt="">
      <div class="negocio">${h(c.nombre_negocio)}</div>
      ${c.direccion ? `<div class="dato">${h(c.direccion)}</div>` : ''}
      ${c.telefono ? `<div class="dato">Tel. ${h(c.telefono)}</div>` : ''}
      <div class="tipo">${h(tipo)}</div><div class="numero">${h(numero)}</div></div>`;
  },

  imprimir(cuerpo) {
    const marco = document.getElementById('marco-impresion');
    marco.classList.remove('oculto');
    marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    marco.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: 80mm auto; margin: 4mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 12px; margin: 0 auto; max-width: 72mm; line-height: 1.4; }
      .encabezado { text-align: center; padding-bottom: 8px; border-bottom: 2px solid #000; }
      .encabezado img { width: 70px; height: 70px; border-radius: 50%; }
      .negocio { font-size: 16px; font-weight: 700; }
      .dato { font-size: 11px; }
      .tipo { margin-top: 6px; font-size: 11px; text-transform: uppercase; }
      .numero { font-size: 14px; font-weight: 700; }
      .meta { margin: 8px 0; }
      .fila { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
      .fila span:last-child { text-align: right; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; font-size: 11px; border-bottom: 1px solid #000; padding: 4px 0; }
      td { padding: 4px 0; vertical-align: top; border-bottom: 1px dashed #999; }
      .num { text-align: right; white-space: nowrap; }
      .quien { font-size: 10px; color: #444; }
      .totales { margin-top: 8px; }
      .total { font-size: 16px; font-weight: 700; border-top: 2px solid #000; margin-top: 4px; padding-top: 4px; }
      .fuerte { font-weight: 700; }
      .tachado td { text-decoration: line-through; }
      .anulado { text-align: center; font-weight: 700; border: 2px solid #000; padding: 4px; }
      .pie { text-align: center; margin-top: 14px; font-size: 12px; }
    </style></head><body>${cuerpo}</body></html>`;
    marco.onload = () => {
      const img = marco.contentDocument.querySelector('img');
      const imprimir = () => { marco.contentWindow.focus(); marco.contentWindow.print(); };
      if (img && !img.complete) { img.onload = imprimir; img.onerror = imprimir; } else imprimir();
    };
  }
};

function nombrePago(m) {
  return { Efectivo: 'Efectivo', Tarjeta: 'Tarjeta', Transferencia: 'Transferencia', Credito: 'Crédito' }[m] || m;
}
