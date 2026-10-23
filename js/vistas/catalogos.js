/* ==========================================================================
   Catálogos sencillos: Servicios, Categorías, Marcas, Proveedores y
   Empleados. Todos usan la misma pantalla: lista, buscar, nuevo, editar.
   ========================================================================== */

/**
 * def = { titulo, icono, tabla, campos, columnas: [[titulo, fn(fila) => html, clase]],
 *         roles (quién ve), extra(cuerpoModal, fila) para agregar secciones al editar }
 */
function catalogo(id, def) {
  vista(id, {
    titulo: def.titulo, icono: def.icono, roles: def.roles || GERENCIA,
    async render(cont) {
      cont.innerHTML = `
        <div class="barra-herramientas">
          <div class="buscador"><i class="bi bi-search"></i><input type="search" id="ct-buscar" placeholder="Buscar…"></div>
          <label class="check" style="margin:0"><input type="checkbox" id="ct-inactivos"> Ver desactivados</label>
          <button class="btn" id="ct-nuevo"><i class="bi bi-plus-lg"></i> ${h(def.nuevo || 'Nuevo')}</button>
        </div>
        ${def.ayuda ? `<p class="suave" style="margin-top:-4px">${def.ayuda}</p>` : ''}
        <div class="panel" id="ct-lista"></div>`;
      let filas = [];
      const cargar = async () => {
        filas = await q(sb.from(def.tabla).select('*').order(def.orden || 'nombre'));
        await App.cargarDatos();
        pintar();
      };
      const pintar = () => {
        const t = cont.querySelector('#ct-buscar').value.trim().toLowerCase();
        const inactivos = cont.querySelector('#ct-inactivos').checked;
        const vis = filas.filter(f => (inactivos ? !f.activo : f.activo) && (!t || JSON.stringify(f).toLowerCase().includes(t)));
        const lista = cont.querySelector('#ct-lista');
        if (!vis.length) { lista.innerHTML = UI.vacio(def.icono, inactivos ? 'No hay registros desactivados.' : 'Todavía no hay registros. Toque "' + (def.nuevo || 'Nuevo') + '".'); return; }
        lista.innerHTML = `<div class="tabla-envoltura"><table class="tabla apilable">
          <thead><tr>${def.columnas.map(c => `<th class="${c[2] || ''}">${h(c[0])}</th>`).join('')}<th></th></tr></thead>
          <tbody>${vis.map((f, i) => `<tr class="clic" data-i="${i}">${def.columnas.map(c => `<td class="${c[2] || ''}" data-t="${h(c[0])}">${c[1](f)}</td>`).join('')}
            <td class="sin-t der"><i class="bi bi-pencil suave"></i></td></tr>`).join('')}</tbody></table></div>`;
        lista.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => formulario(vis[Number(tr.dataset.i)]));
      };
      const formulario = (fila) => {
        const nuevo = !fila;
        const campos = nuevo ? def.campos : [...def.campos, { n: 'activo', t: 'Activo', tipo: 'check' }];
        const cuerpo = document.createElement('div');
        cuerpo.innerHTML = Form.html(campos, fila || {}) + (def.datalist ? def.datalist(filas) : '');
        if (!nuevo && def.extra) def.extra(cuerpo, fila);
        UI.modal({
          titulo: (nuevo ? 'Nuevo: ' : 'Editar: ') + def.singular, cuerpo,
          botones: [
            { texto: 'Cancelar', clase: 'sec' },
            {
              texto: 'Guardar', icono: 'check2', accion: async () => {
                const v = Form.leer(cuerpo, campos);
                for (const c of campos) if (c.tipo === 'select' && v[c.n] === '') v[c.n] = null;
                if (nuevo) await q(sb.from(def.tabla).insert(v));
                else await q(sb.from(def.tabla).update(v).eq('id', fila.id));
                UI.ok('Guardado.');
                await cargar();
              }
            }
          ]
        });
      };
      cont.querySelector('#ct-buscar').oninput = debounce(pintar, 150);
      cont.querySelector('#ct-inactivos').onchange = pintar;
      cont.querySelector('#ct-nuevo').onclick = () => formulario(null);
      UI.cargando(cont.querySelector('#ct-lista'));
      await cargar();
    }
  });
}

const opCategorias = (tipo) => App.datos.categorias.filter(c => c.tipo === tipo).map(c => [c.id, c.nombre + (c.activo ? '' : ' (desactivada)')]);

catalogo('servicios', {
  titulo: 'Servicios', singular: 'servicio', icono: 'scissors', tabla: 'servicios', nuevo: 'Nuevo servicio',
  get campos() {
    return [
      { n: 'nombre', t: 'Nombre del servicio', req: true, ancho: true },
      { n: 'categoria_id', t: 'Categoría', tipo: 'select', vacio: '— Sin categoría —', op: opCategorias('Servicio') },
      { n: 'precio', t: 'Precio (L)', tipo: 'number', min: 0, req: true, inputmode: 'decimal' },
      { n: 'duracion_min', t: 'Duración (minutos)', tipo: 'number', min: 5, req: true, def: 60, inputmode: 'numeric' }
    ];
  },
  columnas: [
    ['Servicio', f => `<strong>${h(f.nombre)}</strong>`],
    ['Categoría', f => h(nombreDe('categorias', f.categoria_id) || '—')],
    ['Duración', f => f.duracion_min + ' min'],
    ['Precio', f => Fmt.L(f.precio), 'num']
  ],
  /** Productos que gasta el servicio: se descuentan del inventario al cobrarlo. */
  extra(cuerpo, servicio) {
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="pildora">Productos que gasta (opcional)</div>
      <p class="suave peq">Si lo configura, al cobrar el servicio se descuentan solos del inventario.</p>
      <div id="si-lista"></div><div class="campo"><div id="si-buscar"></div></div>`;
    cuerpo.appendChild(sec);
    let productos = [];
    const pintar = async () => {
      const filas = await q(sb.from('servicio_insumos').select('*, producto:productos(nombre,unidad)').eq('servicio_id', servicio.id));
      sec.querySelector('#si-lista').innerHTML = filas.length ? `<table class="tabla">${filas.map(f => `<tr>
        <td>${h(f.producto.nombre)}</td><td class="num">${Fmt.num(f.cantidad, 3)} ${h(f.producto.unidad)}</td>
        <td class="der"><button class="btn-icono rojo" data-x="${f.id}" type="button" aria-label="Quitar"><i class="bi bi-trash3"></i></button></td></tr>`).join('')}</table>`
        : '<p class="suave peq">Ninguno.</p>';
      sec.querySelectorAll('[data-x]').forEach(b => b.onclick = async () => {
        try { await q(sb.from('servicio_insumos').delete().eq('id', Number(b.dataset.x))); pintar(); } catch (e) { UI.error(e); }
      });
    };
    q(sb.from('productos').select('id,nombre,codigo,stock,unidad').eq('activo', true).order('nombre')).then(p => {
      productos = p;
      sec.querySelector('#si-buscar').appendChild(selectorProducto(productos, async (prod, input) => {
        input.value = '';
        const v = await UI.pedir('¿Cuánto gasta de ' + prod.nombre + '?', [
          { n: 'cantidad', t: `Cantidad por servicio (${prod.unidad})`, tipo: 'number', min: 0.001, req: true, inputmode: 'decimal', ancho: true,
            ayuda: 'Ej. si un tinte usa media caja, escriba 0.5' }
        ], { boton: 'Agregar' });
        if (!v) return;
        try { await q(sb.from('servicio_insumos').upsert({ servicio_id: servicio.id, producto_id: prod.id, cantidad: v.cantidad }, { onConflict: 'servicio_id,producto_id' })); pintar(); }
        catch (e) { UI.error(e); }
      }, 'Agregar producto que gasta…'));
    }).catch(UI.error);
    pintar().catch(UI.error);
  }
});

catalogo('categorias', {
  titulo: 'Categorías', singular: 'categoría', icono: 'tags', tabla: 'categorias', nuevo: 'Nueva categoría',
  ayuda: 'Sirven para ordenar los productos y servicios y encontrarlos más rápido al cobrar.',
  campos: [
    { n: 'nombre', t: 'Nombre', req: true, ancho: true },
    { n: 'tipo', t: '¿Es para productos o servicios?', tipo: 'select', op: [['Producto', 'Productos'], ['Servicio', 'Servicios']], ancho: true }
  ],
  columnas: [
    ['Categoría', f => `<strong>${h(f.nombre)}</strong>`],
    ['Para', f => `<span class="etiqueta ${f.tipo === 'Servicio' ? 'azul' : ''}">${f.tipo === 'Servicio' ? 'Servicios' : 'Productos'}</span>`]
  ]
});

catalogo('marcas', {
  titulo: 'Marcas', singular: 'marca', icono: 'award', tabla: 'marcas', nuevo: 'Nueva marca',
  campos: [{ n: 'nombre', t: 'Nombre de la marca', req: true, ancho: true }],
  columnas: [['Marca', f => `<strong>${h(f.nombre)}</strong>`]]
});

catalogo('proveedores', {
  titulo: 'Proveedores', singular: 'proveedor', icono: 'truck', tabla: 'proveedores', nuevo: 'Nuevo proveedor',
  campos: [
    { n: 'nombre', t: 'Empresa o nombre', req: true, ancho: true },
    { n: 'contacto', t: 'Persona de contacto' },
    { n: 'telefono', t: 'Teléfono', tipo: 'tel', inputmode: 'tel' },
    { n: 'email', t: 'Correo', tipo: 'email', ancho: true },
    { n: 'notas', t: 'Notas', tipo: 'textarea', ph: 'Ej. entrega los martes, pedido mínimo…' }
  ],
  columnas: [
    ['Proveedor', f => `<strong>${h(f.nombre)}</strong>`],
    ['Contacto', f => h(f.contacto || '—')],
    ['Teléfono', f => f.telefono ? `${h(f.telefono)} <a href="${enlaceWhatsApp(f.telefono, 'Hola, ')}" target="_blank" onclick="event.stopPropagation()" aria-label="WhatsApp"><i class="bi bi-whatsapp"></i></a>` : '—']
  ]
});

catalogo('empleados', {
  titulo: 'Empleados', singular: 'empleado', icono: 'people', tabla: 'empleados', nuevo: 'Nuevo empleado',
  ayuda: 'Las personas que atienden clientes. Aparecen en la agenda y al cobrar servicios.',
  campos: [
    { n: 'nombre', t: 'Nombre', req: true, ancho: true },
    { n: 'puesto', t: 'Puesto', lista: 'lista-puestos', ph: 'Ej. Estilista, Manicurista' },
    { n: 'telefono', t: 'Teléfono', tipo: 'tel', inputmode: 'tel' },
    { n: 'color', t: 'Color en la agenda', tipo: 'color', def: '#9C4F7E' }
  ],
  datalist: (filas) => `<datalist id="lista-puestos">${[...new Set(['Estilista', 'Manicurista', 'Maquillista', 'Cosmetóloga', 'Barbero', 'Recepción', ...filas.map(f => f.puesto).filter(Boolean)])].map(p => `<option>${h(p)}</option>`).join('')}</datalist>`,
  columnas: [
    ['Nombre', f => `<span class="punto" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${h(f.color)};margin-right:8px"></span><strong>${h(f.nombre)}</strong>`],
    ['Puesto', f => h(f.puesto || '—')],
    ['Teléfono', f => h(f.telefono || '—')]
  ]
});
