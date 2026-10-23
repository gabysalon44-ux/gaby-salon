/* ==========================================================================
   Productos: catálogo con foto, precio y existencias.
   El stock no se edita aquí: cambia con Entradas, Salidas y Ventas.
   ========================================================================== */

vista('productos', {
  titulo: 'Productos', icono: 'bag-heart', roles: MOSTRADOR,
  async render(cont) {
    const editable = puede(GERENCIA);
    const cats = App.datos.categorias.filter(c => c.tipo === 'Producto');
    cont.innerHTML = `
      <div class="barra-herramientas">
        <div class="buscador"><i class="bi bi-search"></i><input type="search" id="pr-buscar" placeholder="Buscar producto o código…"></div>
        <select id="pr-cat"><option value="">Todas las categorías</option>${cats.map(c => `<option value="${c.id}">${h(c.nombre)}</option>`).join('')}</select>
        <select id="pr-filtro"><option value="">Activos</option><option value="bajo">Stock bajo</option><option value="insumo">Solo insumos</option><option value="inactivos">Desactivados</option></select>
        ${editable ? '<button class="btn" id="pr-nuevo"><i class="bi bi-plus-lg"></i> Nuevo producto</button>' : ''}
      </div>
      <div id="pr-lista"></div>`;
    UI.cargando(cont.querySelector('#pr-lista'));
    let productos = await q(sb.from('productos').select('*').order('nombre'));
    const recargar = async () => { productos = await q(sb.from('productos').select('*').order('nombre')); pintar(); };

    const pintar = () => {
      const t = cont.querySelector('#pr-buscar').value.trim().toLowerCase();
      const cat = cont.querySelector('#pr-cat').value;
      const f = cont.querySelector('#pr-filtro').value;
      const filas = productos.filter(p =>
        (f === 'inactivos' ? !p.activo : p.activo) &&
        (f !== 'bajo' || Number(p.stock) <= Number(p.stock_minimo)) &&
        (f !== 'insumo' || p.es_insumo) &&
        (!cat || String(p.categoria_id) === cat) &&
        (!t || p.nombre.toLowerCase().includes(t) || (p.codigo || '').toLowerCase().includes(t)));
      const lista = cont.querySelector('#pr-lista');
      if (!filas.length) { lista.innerHTML = '<div class="panel">' + UI.vacio('bag', 'No hay productos que mostrar.') + '</div>'; return; }
      lista.innerHTML = '<div class="cuadricula">' + filas.map((p, i) => {
        const bajo = Number(p.stock) <= Number(p.stock_minimo);
        return `<div class="producto" data-i="${i}">
          <div class="foto">${p.foto_url ? `<img src="${h(p.foto_url)}" alt="" loading="lazy">` : '<i class="bi bi-bag-heart"></i>'}</div>
          <div class="info"><strong>${h(p.nombre)}</strong>
            <span class="suave peq">${h([nombreDe('marcas', p.marca_id), nombreDe('categorias', p.categoria_id)].filter(Boolean).join(' · '))}</span>
            <div class="fila-entre"><span style="font-weight:800">${p.se_vende ? Fmt.L(p.precio) : '<span class="etiqueta gris">Uso interno</span>'}</span>
              <span class="etiqueta ${Number(p.stock) <= 0 ? 'rojo' : bajo ? 'ambar' : 'verde'}">${Fmt.num(p.stock, 3)} ${h(p.unidad === 'Unidad' ? '' : p.unidad)}</span></div>
          </div></div>`;
      }).join('') + '</div>';
      lista.querySelectorAll('.producto').forEach(el => el.onclick = () => this.ficha(filas[Number(el.dataset.i)], recargar));
    };
    ['#pr-cat', '#pr-filtro'].forEach(s => cont.querySelector(s).onchange = pintar);
    cont.querySelector('#pr-buscar').oninput = debounce(pintar, 150);
    if (editable) cont.querySelector('#pr-nuevo').onclick = () => this.formulario(null, recargar);
    pintar();
  },

  ficha(p, recargar) {
    const g = puede(GERENCIA);
    const cuerpo = `
      ${p.foto_url ? `<img src="${h(p.foto_url)}" alt="" style="width:100%;max-height:240px;object-fit:contain;border-radius:14px;background:var(--rosa-50)">` : ''}
      <div class="lista-def">
        ${p.codigo ? `<div><span>Código</span><span>${h(p.codigo)}</span></div>` : ''}
        <div><span>Categoría</span><span>${h(nombreDe('categorias', p.categoria_id) || '—')}</span></div>
        <div><span>Marca</span><span>${h(nombreDe('marcas', p.marca_id) || '—')}</span></div>
        <div><span>Proveedor</span><span>${h(nombreDe('proveedores', p.proveedor_id) || '—')}</span></div>
        <div><span>Precio de venta</span><span>${p.se_vende ? Fmt.L(p.precio) : 'No se vende'}</span></div>
        ${g ? `<div><span>Costo</span><span>${Fmt.L(p.costo)}</span></div>` : ''}
        <div><span>Existencia</span><span>${Fmt.num(p.stock, 3)} ${h(p.unidad)}</span></div>
        <div><span>Avisar cuando queden</span><span>${Fmt.num(p.stock_minimo, 3)}</span></div>
        ${p.es_insumo ? '<div><span>Uso</span><span>Se gasta en servicios</span></div>' : ''}
      </div>`;
    const botones = [{ texto: 'Movimientos', clase: 'sec', icono: 'list-ul', accion: () => { kardex(p); return false; } }];
    if (g) botones.push({ texto: 'Editar', icono: 'pencil', accion: () => this.formulario(p, recargar) });
    UI.modal({ titulo: p.nombre, cuerpo, botones, sinFoco: true });
  },

  formulario(p, recargar) {
    const nuevo = !p;
    let fotoUrl = p ? p.foto_url : '';
    let fotoArchivo = null;
    const op = (lista, tipo) => App.datos[lista].filter(x => (x.activo || (p && [p.categoria_id, p.marca_id, p.proveedor_id].includes(x.id))) && (!tipo || x.tipo === tipo)).map(x => [x.id, x.nombre]);
    const campos = [
      { n: 'nombre', t: 'Nombre', req: true, ancho: true },
      { n: 'categoria_id', t: 'Categoría', tipo: 'select', vacio: '— Sin categoría —', op: op('categorias', 'Producto') },
      { n: 'marca_id', t: 'Marca', tipo: 'select', vacio: '— Sin marca —', op: op('marcas') },
      { n: 'precio', t: 'Precio de venta (L)', tipo: 'number', min: 0, inputmode: 'decimal', req: true },
      { n: 'costo', t: 'Costo (L)', tipo: 'number', min: 0, inputmode: 'decimal', ayuda: 'Se actualiza solo con cada entrada.' },
      ...(nuevo ? [{ n: 'stock_inicial', t: '¿Cuántos hay ahora?', tipo: 'number', min: 0, inputmode: 'decimal', def: 0 }] : []),
      { n: 'stock_minimo', t: 'Avisar cuando queden', tipo: 'number', min: 0, inputmode: 'decimal', def: 1 },
      { n: 'unidad', t: 'Unidad', lista: 'lista-unidades', def: 'Unidad', ayuda: 'Unidad, ml, gramos, onzas…' },
      { n: 'proveedor_id', t: 'Proveedor', tipo: 'select', vacio: '— Sin proveedor —', op: op('proveedores') },
      { n: 'codigo', t: 'Código (opcional)' },
      { n: 'se_vende', t: 'Se vende a clientes', tipo: 'check', def: true },
      { n: 'es_insumo', t: 'Se gasta en servicios (insumo)', tipo: 'check' },
      ...(nuevo ? [] : [{ n: 'activo', t: 'Producto activo', tipo: 'check' }])
    ];
    const cuerpo = document.createElement('div');
    cuerpo.innerHTML = `
      <div class="foto-editor">
        <div class="vista-foto">${fotoUrl ? `<img src="${h(fotoUrl)}" alt="">` : '<i class="bi bi-camera"></i>'}</div>
        <div><label class="btn sec chico" style="cursor:pointer"><i class="bi bi-image"></i> ${fotoUrl ? 'Cambiar foto' : 'Agregar foto'}
          <input type="file" accept="image/*" class="oculto" id="pf-foto"></label>
          ${fotoUrl ? '<button class="btn chico suave mt" id="pf-quitar" type="button">Quitar foto</button>' : ''}
          <p class="suave peq">Puede tomarla con la cámara del teléfono.</p></div>
      </div>
      ${Form.html(campos, p || {})}
      <datalist id="lista-unidades"><option>Unidad</option><option>ml</option><option>Litro</option><option>Gramos</option><option>Onzas</option><option>Caja</option><option>Paquete</option></datalist>`;
    cuerpo.querySelector('#pf-foto').onchange = (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      fotoArchivo = f;
      cuerpo.querySelector('.vista-foto').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
    };
    const quitar = cuerpo.querySelector('#pf-quitar');
    if (quitar) quitar.onclick = () => { fotoUrl = ''; fotoArchivo = null; cuerpo.querySelector('.vista-foto').innerHTML = '<i class="bi bi-camera"></i>'; };

    UI.modal({
      titulo: nuevo ? 'Nuevo producto' : 'Editar producto', cuerpo,
      botones: [
        { texto: 'Cancelar', clase: 'sec' },
        {
          texto: 'Guardar', icono: 'check2', accion: async () => {
            const v = Form.leer(cuerpo, campos);
            if (!v.se_vende && !v.es_insumo) throw new Error('Marque si se vende, si se gasta en servicios, o ambas.');
            if (fotoArchivo) fotoUrl = await subirFoto(fotoArchivo);
            await rpc('guardar_producto', { p: { ...v, id: p ? p.id : null, foto_url: fotoUrl, activo: nuevo ? true : v.activo } });
            UI.ok('Producto guardado.');
            recargar();
          }
        }
      ]
    });
  }
});

/** Reduce la foto (máx. 800 px) y la sube a Supabase Storage. Devuelve la URL pública. */
async function subirFoto(archivo) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('No se pudo leer la imagen.'));
    i.src = URL.createObjectURL(archivo);
  });
  const escala = Math.min(1, 800 / Math.max(img.width, img.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(img.width * escala);
  lienzo.height = Math.round(img.height * escala);
  lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
  const blob = await new Promise(res => lienzo.toBlob(res, 'image/jpeg', 0.82));
  const ruta = 'productos/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
  const { error } = await sb.storage.from('fotos').upload(ruta, blob, { contentType: 'image/jpeg' });
  if (error) throw traducirError(error);
  return sb.storage.from('fotos').getPublicUrl(ruta).data.publicUrl;
}

const NOMBRE_MOV = {
  Inicial: 'Stock inicial', Compra: 'Entrada', Venta: 'Venta', Consumo: 'Usado en servicio',
  Merma: 'Merma / dañado', Uso_Interno: 'Uso interno', Ajuste: 'Ajuste por conteo', Devolucion: 'Devolución'
};

/** Movimientos (kardex) de un producto. */
async function kardex(p) {
  try {
    const movs = await q(sb.from('movimientos').select('*, usuario:perfiles(nombre)').eq('producto_id', p.id).order('fecha', { ascending: false }).limit(150));
    UI.modal({
      titulo: 'Movimientos: ' + p.nombre, ancho: true, sinFoco: true,
      cuerpo: movs.length ? `<div class="tabla-envoltura"><table class="tabla apilable">
        <thead><tr><th>Fecha</th><th>Tipo</th><th class="num">Cantidad</th><th class="num">Quedaron</th><th>Detalle</th><th>Usuario</th></tr></thead>
        <tbody>${movs.map(m => `<tr><td data-t="Fecha">${Fmt.fechaHora(m.fecha)}</td><td data-t="Tipo">${h(NOMBRE_MOV[m.tipo] || m.tipo)}</td>
          <td class="num" data-t="Cantidad" style="color:${Number(m.cantidad) < 0 ? 'var(--rojo)' : 'var(--verde)'};font-weight:800">${Number(m.cantidad) > 0 ? '+' : ''}${Fmt.num(m.cantidad, 3)}</td>
          <td class="num" data-t="Quedaron">${Fmt.num(m.stock_resultante, 3)}</td><td data-t="Detalle">${h(m.nota)}</td>
          <td data-t="Usuario">${h(m.usuario ? m.usuario.nombre : '')}</td></tr>`).join('')}</tbody></table></div>`
        : UI.vacio('list', 'Sin movimientos.')
    });
  } catch (e) { UI.error(e); }
}
