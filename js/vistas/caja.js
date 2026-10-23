/* ==========================================================================
   Caja: abrir al iniciar el día, ver cuánto debe haber y cerrar con arqueo.
   ========================================================================== */

vista('caja', {
  titulo: 'Caja', icono: 'safe2', roles: MOSTRADOR,
  async render(cont) {
    UI.cargando(cont);
    await App.refrescarCaja();
    const historial = await q(sb.from('cajas')
      .select('*, abrio:perfiles!cajas_usuario_apertura_fkey(nombre), cerro:perfiles!cajas_usuario_cierre_fkey(nombre)')
      .eq('estado', 'Cerrada').order('apertura', { ascending: false }).limit(15));

    let principal;
    if (!App.caja) {
      principal = `<div class="panel centro">
        <i class="bi bi-lock-fill" style="font-size:3.5rem;color:var(--malva)"></i>
        <h2 class="mt">La caja está cerrada</h2>
        <p class="suave">Ábrala al iniciar el día contando el efectivo de la gaveta.</p>
        <button class="btn grande" id="cj-abrir" style="max-width:360px"><i class="bi bi-unlock"></i> Abrir caja</button></div>`;
    } else {
      const a = await rpc('arqueo_caja');
      principal = `<div class="kpis">
          <div class="kpi vino"><small>Debe haber en la gaveta</small><strong>${Fmt.L(a.esperado)}</strong></div>
          <div class="kpi"><small>Vendido hoy en esta caja</small><strong>${Fmt.L(a.total_vendido)}</strong></div>
          <div class="kpi"><small>Ventas</small><strong>${a.cantidad_ventas}</strong></div>
        </div>
        <div class="dos-col">
          <div class="panel"><h3 class="panel-titulo"><i class="bi bi-cash-stack"></i> Efectivo</h3>
            <div class="lista-def">
              <div><span>Con que abrió (${h(Fmt.hora(a.caja.apertura))})</span><span>${Fmt.L(a.monto_inicial)}</span></div>
              <div><span>+ Ventas en efectivo</span><span>${Fmt.L(a.ventas_efectivo)}</span></div>
              <div><span>+ Abonos en efectivo</span><span>${Fmt.L(a.abonos_efectivo)}</span></div>
              ${Number(a.devoluciones_efectivo) ? `<div><span>− Devoluciones de abonos</span><span>${Fmt.L(a.devoluciones_efectivo)}</span></div>` : ''}
              <div class="total"><span>Debe haber</span><span>${Fmt.L(a.esperado)}</span></div>
            </div></div>
          <div class="panel"><h3 class="panel-titulo"><i class="bi bi-credit-card"></i> Otros pagos (no están en la gaveta)</h3>
            <div class="lista-def">
              <div><span>Tarjeta</span><span>${Fmt.L(a.ventas_tarjeta)}</span></div>
              <div><span>Transferencia</span><span>${Fmt.L(a.ventas_transferencia)}</span></div>
              <div><span>Abonos con tarjeta o transferencia</span><span>${Fmt.L(a.abonos_otros)}</span></div>
              <div><span>Vendido a crédito</span><span>${Fmt.L(a.ventas_credito)}</span></div>
            </div></div>
        </div>
        <div class="panel mt"><h3 class="panel-titulo">Cerrar la caja</h3>
          <p class="suave" style="margin-top:0">Cuente todo el efectivo de la gaveta y escriba el total.</p>
          <div class="campos">
            <div class="campo"><label for="cj-contado">Efectivo contado (L)</label><input id="cj-contado" type="number" min="0" step="any" inputmode="decimal"></div>
            <div class="campo"><label>Diferencia</label><div id="cj-dif" style="font-size:1.4rem;font-weight:800;padding-top:6px">—</div></div>
            <div class="campo ancho"><label for="cj-obs">Observaciones</label><textarea id="cj-obs" placeholder="Obligatorio si hay diferencia"></textarea></div>
          </div>
          <button class="btn grande" id="cj-cerrar"><i class="bi bi-lock"></i> Cerrar caja</button>
        </div>`;
      cont.dataset.esperado = a.esperado;
    }

    cont.innerHTML = principal + `
      <div class="panel mt"><h3 class="panel-titulo">Cierres anteriores</h3>
        ${historial.length ? `<div class="tabla-envoltura"><table class="tabla apilable">
          <thead><tr><th>Apertura</th><th>Cierre</th><th>Cerró</th><th class="num">Esperado</th><th class="num">Contado</th><th class="num">Diferencia</th></tr></thead>
          <tbody>${historial.map(c => `<tr>
            <td data-t="Apertura">${Fmt.fechaHora(c.apertura)}</td><td data-t="Cierre">${Fmt.fechaHora(c.cierre)}</td>
            <td data-t="Cerró">${h(c.cerro ? c.cerro.nombre : '')}</td>
            <td class="num" data-t="Esperado">${Fmt.L(c.efectivo_esperado)}</td><td class="num" data-t="Contado">${Fmt.L(c.efectivo_contado)}</td>
            <td class="num" data-t="Diferencia">${Number(c.diferencia) === 0 ? '<span class="etiqueta verde">Cuadró</span>'
              : `<span class="etiqueta ${Number(c.diferencia) < 0 ? 'rojo' : 'ambar'}" title="${h(c.observaciones)}">${Fmt.L(c.diferencia)}</span>`}</td></tr>`).join('')}
          </tbody></table></div>` : UI.vacio('clock-history', 'Todavía no hay cierres.')}
      </div>`;

    const abrir = cont.querySelector('#cj-abrir');
    if (abrir) abrir.onclick = async () => { if (await abrirCajaDialogo()) this.render(cont); };

    const contado = cont.querySelector('#cj-contado');
    if (contado) {
      const esperado = Number(cont.dataset.esperado);
      contado.oninput = () => {
        const d = cont.querySelector('#cj-dif');
        if (contado.value === '') { d.textContent = '—'; d.style.color = ''; return; }
        const dif = redondear(Number(contado.value) - esperado);
        d.textContent = dif === 0 ? 'Cuadra exacto ✓' : (dif > 0 ? 'Sobran ' : 'Faltan ') + Fmt.L(Math.abs(dif));
        d.style.color = dif === 0 ? 'var(--verde)' : 'var(--rojo)';
      };
      cont.querySelector('#cj-cerrar').onclick = async () => {
        if (contado.value === '') return UI.error(new Error('Escriba cuánto efectivo contó.'));
        const obs = cont.querySelector('#cj-obs');
        if (redondear(Number(contado.value) - esperado) !== 0 && !obs.value.trim()) {
          obs.focus();
          return UI.error(new Error('La caja no cuadra. Escriba en Observaciones qué pasó con la diferencia.'));
        }
        if (!await UI.confirmar(`Se cerrará la caja con ${Fmt.L(contado.value)} contados. Después no se puede cobrar hasta abrirla de nuevo.`, { si: 'Cerrar caja' })) return;
        try {
          const r = await rpc('cerrar_caja', { p_contado: Number(contado.value), p_observaciones: cont.querySelector('#cj-obs').value });
          await App.refrescarCaja();
          UI.ok(Number(r.diferencia) === 0 ? 'Caja cerrada. ¡Cuadró exacto!' : 'Caja cerrada con diferencia de ' + Fmt.L(r.diferencia) + '.');
          this.render(cont);
        } catch (e) { UI.error(e); }
      };
    }
  }
});
