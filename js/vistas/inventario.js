/* ==========================================================================
   Inventario: Entradas (compras a proveedores) y Salidas (merma, uso
   interno y ajustes por conteo físico).
   ========================================================================== */

/** Buscador de productos con lista desplegable. */
function selectorProducto(productos, onElegir, placeholder = 'Buscar producto…') {
  const cont = document.createElement('div');
  cont.className = 'selector';
  cont.innerHTML = `<div class="buscador"><i class="bi bi-search"></i><input type="search" placeholder="${h(placeholder)}" autocomplete="off"></div>
    <div class="selector-lista oculto"></div>`;
  const input = cont.querySelector('input');
  const lista = cont.querySelector('.selector-lista');
  const mostrar = () => {
    const t = input.value.trim().toLowerCase();
    const filas = productos.filter(p => !t || p.nombre.toLowerCase().includes(t) || (p.codigo || '').toLowerCase().includes(t)).slice(0, 30);
    lista.innerHTML = filas.length
      ? filas.map((p, i) => `<button data-i="${i}" type="button"><strong>${h(p.nombre)}</strong> <small>· hay ${Fmt.num(p.stock, 3)} ${h(p.unidad)}</small></button>`).join('')
      : '<button type="button" disabled>No se encontró</button>';
    lista.classList.remove('oculto');
    lista.querySelectorAll('[data-i]').forEach(b => b.onmousedown = (ev) => {
      ev.preventDefault();
      const p = filas[Number(b.dataset.i)];
      lista.classList.add('oculto');
      onElegir(p, input);
    });
  };
  input.addEventListener('focus', mostrar);
  input.addEventListener('input', mostrar);
  input.addEventListener('blur', () => setTimeout(() => lista.classList.add('oculto'), 150));
  return cont;
}

/* ------------------------------------------------------------------------ */

vista('entradas', {
  titulo: 'Entradas', icono: 'box-arrow-in-down', roles: GERENCIA,
  async render(cont) {
    cont.innerHTML = `<div class="barra-herramientas">
        <p class="crece suave" style="margin:0">Registre aquí la mercadería que llega. El stock y el costo se actualizan solos.</p>
        <button class="btn" id="en-nueva"><i class="bi bi-plus-lg"></i> Nueva entrada</button></div>
      <div class="panel" id="en-lista"></div>`;
    cont.querySelector('#en-nueva').onclick = () => this.nueva(() => this.render(cont));
    const lista = cont.querySelector('#en-lista');
    UI.cargando(lista);
    const compras = await q(sb.from('compras').select('*, proveedor:proveedores(nombre), usuario:perfiles(nombre)').order('fecha', { ascending: false }).limit(100));
    if (!compras.length) { lista.innerHTML = UI.vacio('box-seam', 'Todavía no hay entradas registradas.'); return; }
    lista.innerHTML = `<div class="tabla-envoltura"><table class="tabla apilable">
      <thead><tr><th>Número</th><th>Fecha</th><th>Proveedor</th><th>Registró</th><th class="num">Total</th></tr></thead>
      <tbody>${compras.map((c, i) => `<tr class="clic" data-i="${i}"><td data-t="Número"><strong>${h(c.numero)}</strong></td>
        <td data-t="Fecha">${Fmt.fechaHora(c.fecha)}</td><td data-t="Proveedor">${h(c.proveedor ? c.proveedor.nombre : '—')}</td>
        <td data-t="Registró">${h(c.usuario ? c.usuario.nombre : '')}</td><td class="num" data-t="Total">${Fmt.L(c.total)}</td></tr>`).join('')}</tbody></table></div>`;
    lista.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => this.detalle(compras[Number(tr.dataset.i)]));
  },

  async detalle(c) {
    try {
      const lineas = await q(sb.from('compras_detalle').select('*, producto:productos(nombre)').eq('compra_id', c.id).order('id'));
      UI.modal({
        titulo: 'Entrada ' + c.numero, sinFoco: true,
        cuerpo: `<p class="suave">${Fmt.fechaHora(c.fecha)} · ${h(c.proveedor ? c.proveedor.nombre : 'Sin proveedor')}</p>
          <table class="tabla"><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Costo</th><th class="num">Importe</th></tr></thead><tbody>
          ${lineas.map(l => `<tr><td>${h(l.producto.nombre)}</td><td class="num">${Fmt.num(l.cantidad, 3)}</td><td class="num">${Fmt.L(l.costo_unitario)}</td><td class="num">${Fmt.L(l.importe)}</td></tr>`).join('')}
          </tbody></table><div class="totales"><div class="total"><span>Total</span><span>${Fmt.L(c.total)}</span></div></div>
          ${c.nota ? `<p><b>Nota:</b> ${h(c.nota)}</p>` : ''}`
      });
    } catch (e) { UI.error(e); }
  },

  async nueva(recargar) {
    const productos = await q(sb.from('productos').select('id,nombre,codigo,stock,unidad,costo').eq('activo', true).order('nombre'));
    const lineas = [];
    const cuerpo = document.createElement('div');
    cuerpo.innerHTML = `<div class="campos">
        <div class="campo"><label for="en-prov">Proveedor</label><select id="en-prov"><option value="">— Sin proveedor —</option>
          ${App.datos.proveedores.filter(p => p.activo).map(p => `<option value="${p.id}">${h(p.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="en-nota">Nota / No. de factura</label><input id="en-nota"></div>
      </div>
      <div class="campo"><label>Agregar producto</label><div id="en-buscar"></div></div>
      <div id="en-lineas"></div>`;
    const pintar = () => {
      const el = cuerpo.querySelector('#en-lineas');
      if (!lineas.length) { el.innerHTML = UI.vacio('box-seam', 'Busque y agregue los productos que llegaron.'); return; }
      el.innerHTML = `<table class="tabla"><thead><tr><th>Producto</th><th>Cantidad</th><th>Costo c/u (L)</th><th class="num">Importe</th><th></th></tr></thead><tbody>
        ${lineas.map((l, i) => `<tr><td>${h(l.nombre)}</td>
          <td><input type="number" min="0" step="any" inputmode="decimal" data-c="${i}" value="${l.cantidad}" style="width:100px"></td>
          <td><input type="number" min="0" step="any" inputmode="decimal" data-k="${i}" value="${l.costo_unitario}" style="width:120px"></td>
          <td class="num" data-imp="${i}">${Fmt.L(l.cantidad * l.costo_unitario)}</td>
          <td><button class="btn-icono rojo" data-x="${i}" aria-label="Quitar"><i class="bi bi-trash3"></i></button></td></tr>`).join('')}
        </tbody></table><div class="totales"><div class="total"><span>Total</span><span id="en-total"></span></div></div>`;
      const total = () => {
        cuerpo.querySelector('#en-total').textContent = Fmt.L(lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0));
        lineas.forEach((l, i) => { cuerpo.querySelector(`[data-imp="${i}"]`).textContent = Fmt.L(l.cantidad * l.costo_unitario); });
      };
      el.querySelectorAll('[data-c]').forEach(inp => inp.oninput = () => { lineas[Number(inp.dataset.c)].cantidad = Number(inp.value) || 0; total(); });
      el.querySelectorAll('[data-k]').forEach(inp => inp.oninput = () => { lineas[Number(inp.dataset.k)].costo_unitario = Number(inp.value) || 0; total(); });
      el.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { lineas.splice(Number(b.dataset.x), 1); pintar(); });
      total();
    };
    cuerpo.querySelector('#en-buscar').appendChild(selectorProducto(productos, (p, input) => {
      input.value = '';
      if (lineas.some(l => l.producto_id === p.id)) return UI.aviso('Ese producto ya está en la lista.');
      lineas.push({ producto_id: p.id, nombre: p.nombre, cantidad: 1, costo_unitario: Number(p.costo) });
      pintar();
      const ultimo = cuerpo.querySelector(`[data-c="${lineas.length - 1}"]`);
      if (ultimo) { ultimo.focus(); ultimo.select(); }
    }));
    pintar();
    UI.modal({
      titulo: 'Nueva entrada de mercadería', cuerpo, ancho: true,
      botones: [
        { texto: 'Cancelar', clase: 'sec' },
        {
          texto: 'Guardar entrada', icono: 'check2', accion: async () => {
            if (!lineas.length) throw new Error('Agregue al menos un producto.');
            if (lineas.some(l => !(l.cantidad > 0))) throw new Error('Revise las cantidades: deben ser mayores que cero.');
            const r = await rpc('registrar_entrada', { p: {
              proveedor_id: cuerpo.querySelector('#en-prov').value || null,
              nota: cuerpo.querySelector('#en-nota').value.trim(),
              lineas: lineas.map(({ producto_id, cantidad, costo_unitario }) => ({ producto_id, cantidad, costo_unitario }))
            } });
            UI.ok(`Entrada ${r.numero} registrada por ${Fmt.L(r.total)}.`);
            recargar();
          }
        }
      ]
    });
  }
});

/* ------------------------------------------------------------------------ */

vista('salidas', {
  titulo: 'Salidas', icono: 'box-arrow-up', roles: GERENCIA,
  async render(cont) {
    const productos = await q(sb.from('productos').select('id,nombre,codigo,stock,unidad').eq('activo', true).order('nombre'));
    let producto = null;
    let tipo = 'Merma';
    const tipos = [['Merma', 'heartbreak', 'Dañado o vencido'], ['Uso_Interno', 'house-heart', 'Uso interno'], ['Ajuste', 'clipboard-check', 'Ajuste por conteo']];
    cont.innerHTML = `
      <div class="dos-col">
        <div class="panel"><h3 class="panel-titulo">Registrar una salida</h3>
          <div class="campo"><label>Producto</label><div id="sa-prod"></div><div id="sa-info" class="suave peq"></div></div>
          <div class="campo"><label>¿Qué pasó?</label><div class="opciones-pago" style="grid-template-columns:repeat(3,1fr)">
            ${tipos.map(([k, ic, t]) => `<button class="opcion ${k === tipo ? 'activa' : ''}" data-t="${k}" type="button"><i class="bi bi-${ic}"></i>${t}</button>`).join('')}</div></div>
          <div class="campo"><label for="sa-cant" id="sa-lbl">Cantidad que sale</label><input id="sa-cant" type="number" min="0" step="any" inputmode="decimal"></div>
          <div class="campo"><label for="sa-motivo">Motivo *</label><input id="sa-motivo" placeholder="Ej. se derramó, se usó para limpieza…"></div>
          <button class="btn grande" id="sa-guardar"><i class="bi bi-check2"></i> Registrar salida</button>
        </div>
        <div class="panel"><h3 class="panel-titulo">Últimas salidas y ajustes</h3><div id="sa-lista"></div></div>
      </div>`;

    cont.querySelector('#sa-prod').appendChild(selectorProducto(productos, (p, input) => {
      producto = p; input.value = p.nombre;
      cont.querySelector('#sa-info').textContent = `Hay ${Fmt.num(p.stock, 3)} ${p.unidad} en el sistema.`;
    }));
    cont.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
      tipo = b.dataset.t;
      cont.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('activa', x === b));
      cont.querySelector('#sa-lbl').textContent = tipo === 'Ajuste' ? '¿Cuántos hay realmente? (lo que contó)' : 'Cantidad que sale';
    });
    cont.querySelector('#sa-guardar').onclick = async () => {
      try {
        if (!producto) throw new Error('Elija el producto.');
        const n = cont.querySelector('#sa-cant').value;
        if (n === '') throw new Error(tipo === 'Ajuste' ? 'Escriba la cantidad que contó.' : 'Escriba la cantidad que sale.');
        const motivo = cont.querySelector('#sa-motivo').value.trim();
        if (!motivo) throw new Error('Escriba el motivo.');
        const nuevo = await rpc('registrar_salida', { p: {
          producto_id: producto.id, tipo, motivo,
          cantidad: tipo === 'Ajuste' ? null : Number(n), nuevo_stock: tipo === 'Ajuste' ? Number(n) : null
        } });
        UI.ok(`Listo. Ahora hay ${Fmt.num(nuevo, 3)} de "${producto.nombre}".`);
        this.render(cont);
      } catch (e) { UI.error(e); }
    };

    const lista = cont.querySelector('#sa-lista');
    const movs = await q(sb.from('movimientos').select('*, producto:productos(nombre), usuario:perfiles(nombre)')
      .in('tipo', ['Merma', 'Uso_Interno', 'Ajuste']).order('fecha', { ascending: false }).limit(40));
    lista.innerHTML = movs.length ? `<table class="tabla">${movs.map(m => `<tr>
        <td><strong>${h(m.producto.nombre)}</strong><div class="suave peq">${Fmt.fechaHora(m.fecha)} · ${h(NOMBRE_MOV[m.tipo])} · ${h(m.nota)}</div></td>
        <td class="num" style="color:${Number(m.cantidad) < 0 ? 'var(--rojo)' : 'var(--verde)'};font-weight:800">${Number(m.cantidad) > 0 ? '+' : ''}${Fmt.num(m.cantidad, 3)}</td></tr>`).join('')}</table>`
      : UI.vacio('box-seam', 'Sin salidas registradas.');
  }
});
