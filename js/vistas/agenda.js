/* ==========================================================================
   Agenda: citas del día. En pantalla grande, una columna por empleado;
   en teléfono, una lista por hora. Tocar un espacio vacío crea una cita.
   ========================================================================== */

const Agenda = { fecha: null };
const ESTADOS_CITA = {
  Pendiente: ['', 'Pendiente'], Confirmada: ['verde', 'Confirmada'], Completada: ['azul', 'Completada'],
  Cancelada: ['gris', 'Cancelada'], No_Asistio: ['rojo', 'No asistió']
};
const MIN_FILA = 15;   // cada fila de la cuadrícula son 15 minutos

vista('agenda', {
  titulo: 'Agenda', icono: 'calendar-heart', roles: TODOS,
  async render(cont, params) {
    Agenda.fecha = params.fecha || Agenda.fecha || Fmt.hoy();
    const editable = puede(MOSTRADOR);
    cont.innerHTML = `
      <div class="agenda-nav">
        <button class="btn-icono" id="ag-ant" aria-label="Día anterior"><i class="bi bi-chevron-left"></i></button>
        <button class="btn chico suave" id="ag-hoy">Hoy</button>
        <button class="btn-icono" id="ag-sig" aria-label="Día siguiente"><i class="bi bi-chevron-right"></i></button>
        <input type="date" id="ag-fecha" value="${Agenda.fecha}" aria-label="Fecha">
        <span class="agenda-fecha crece">${h(Fmt.fechaLarga(Agenda.fecha))}</span>
        ${editable ? '<button class="btn" id="ag-nueva"><i class="bi bi-plus-lg"></i> Nueva cita</button>' : ''}
      </div>
      <div id="ag-cuerpo"></div>`;
    const ir = (f) => { Agenda.fecha = f; this.render(cont, {}); };
    cont.querySelector('#ag-ant').onclick = () => ir(Fmt.sumarDias(Agenda.fecha, -1));
    cont.querySelector('#ag-sig').onclick = () => ir(Fmt.sumarDias(Agenda.fecha, 1));
    cont.querySelector('#ag-hoy').onclick = () => ir(Fmt.hoy());
    cont.querySelector('#ag-fecha').onchange = (ev) => ev.target.value && ir(ev.target.value);
    if (editable) cont.querySelector('#ag-nueva').onclick = () => this.formulario({ fecha: Agenda.fecha }, () => this.render(cont, {}));

    const cuerpo = cont.querySelector('#ag-cuerpo');
    UI.cargando(cuerpo);
    const citas = await q(sb.from('citas')
      .select('*, cliente:clientes(id,nombre,telefono,credito_habilitado,limite_credito)')
      .eq('fecha', Agenda.fecha).order('hora_inicio'));
    const recargar = () => this.render(cont, {});
    if (window.matchMedia('(max-width: 700px)').matches) this.lista(cuerpo, citas, recargar);
    else this.cuadricula(cuerpo, citas, recargar);
  },

  lista(cuerpo, citas, recargar) {
    if (!citas.length) { cuerpo.innerHTML = UI.vacio('calendar', 'No hay citas este día.'); return; }
    cuerpo.innerHTML = citas.map((c, i) => {
      const e = App.datos.empleados.find(x => x.id === c.empleado_id) || {};
      const [clase, texto] = ESTADOS_CITA[c.estado];
      return `<div class="cita-tarjeta" data-i="${i}">
        <span class="franja" style="background:${h(e.color || '#9C4F7E')}"></span>
        <div class="hora">${Fmt.hora(c.hora_inicio)}<div class="suave peq">${Fmt.hora(c.hora_fin)}</div></div>
        <div class="crece"><strong>${h(c.cliente ? c.cliente.nombre : 'Sin cliente')}</strong>
          <div class="suave peq">${h(nombreDe('servicios', c.servicio_id) || 'Servicio')} · ${h(e.nombre || '')}</div></div>
        <span class="etiqueta ${clase}">${texto}</span></div>`;
    }).join('');
    cuerpo.querySelectorAll('.cita-tarjeta').forEach(t => t.onclick = () => this.detalle(citas[Number(t.dataset.i)], recargar));
  },

  cuadricula(cuerpo, citas, recargar) {
    const usados = new Set(citas.map(c => c.empleado_id));
    const empleados = App.datos.empleados.filter(e => e.activo || usados.has(e.id));
    if (!empleados.length) { cuerpo.innerHTML = UI.vacio('people', 'Primero registre empleados en el módulo Empleados.'); return; }

    // Horario visible: el del negocio, ampliado si hay citas fuera de él
    let ini = Fmt.minutos(App.config.hora_apertura.slice(0, 5));
    let fin = Fmt.minutos(App.config.hora_cierre.slice(0, 5));
    citas.forEach(c => { ini = Math.min(ini, Fmt.minutos(c.hora_inicio.slice(0, 5))); fin = Math.max(fin, Fmt.minutos(c.hora_fin.slice(0, 5))); });
    ini = Math.floor(ini / 30) * 30; fin = Math.ceil(fin / 30) * 30;
    const filas = (fin - ini) / MIN_FILA;
    const editable = puede(MOSTRADOR);

    let html = `<div class="agenda-grid" style="grid-template-columns: 70px repeat(${empleados.length}, minmax(160px, 1fr)); grid-template-rows: auto repeat(${filas}, 24px)">`;
    html += '<div class="agenda-cab" style="grid-column:1;grid-row:1"></div>';
    empleados.forEach((e, i) => {
      html += `<div class="agenda-cab" style="grid-column:${i + 2};grid-row:1"><span class="punto" style="background:${h(e.color)}"></span>${h(e.nombre)}</div>`;
    });
    for (let m = ini; m < fin; m += 30) {
      const fila = (m - ini) / MIN_FILA + 2;
      html += `<div class="agenda-hora" style="grid-column:1;grid-row:${fila} / span 2">${Fmt.hora12(Fmt.hhmm(m))}</div>`;
      empleados.forEach((e, i) => {
        html += `<div class="agenda-celda" data-emp="${e.id}" data-hora="${Fmt.hhmm(m)}" style="grid-column:${i + 2};grid-row:${fila} / span 2"></div>`;
      });
    }
    citas.forEach((c, n) => {
      const col = empleados.findIndex(e => e.id === c.empleado_id) + 2;
      const a = Math.round((Fmt.minutos(c.hora_inicio.slice(0, 5)) - ini) / MIN_FILA) + 2;
      const b = Math.max(a + 1, Math.round((Fmt.minutos(c.hora_fin.slice(0, 5)) - ini) / MIN_FILA) + 2);
      const e = empleados[col - 2];
      html += `<div class="cita-bloque ${c.estado}" data-n="${n}" style="grid-column:${col};grid-row:${a} / ${b};background:${h(e.color)}">
        <strong>${h(c.cliente ? c.cliente.nombre : 'Sin cliente')}</strong>
        ${Fmt.hora(c.hora_inicio)}–${Fmt.hora(c.hora_fin)} · ${h(nombreDe('servicios', c.servicio_id))}</div>`;
    });
    html += '</div>';
    cuerpo.innerHTML = `<div class="agenda-grid-env">${html}</div>
      ${editable ? '<p class="suave peq mt">Toque un espacio vacío para agendar en esa hora.</p>' : ''}`;

    cuerpo.querySelectorAll('.cita-bloque').forEach(el => el.onclick = () => this.detalle(citas[Number(el.dataset.n)], recargar));
    if (editable) cuerpo.querySelectorAll('.agenda-celda').forEach(el => el.onclick = () =>
      this.formulario({ fecha: Agenda.fecha, empleado_id: Number(el.dataset.emp), hora_inicio: el.dataset.hora }, recargar));
  },

  detalle(c, recargar) {
    const [clase, texto] = ESTADOS_CITA[c.estado];
    const servicio = App.datos.servicios.find(s => s.id === c.servicio_id);
    const abierta = ['Pendiente', 'Confirmada'].includes(c.estado);
    const editable = puede(MOSTRADOR) && abierta;
    const tel = c.cliente && c.cliente.telefono;
    const cuerpo = `<div class="lista-def">
        <div><span>Cliente</span><span>${h(c.cliente ? c.cliente.nombre : 'Sin cliente')}</span></div>
        ${tel ? `<div><span>Teléfono</span><span>${h(tel)}</span></div>` : ''}
        <div><span>Servicio</span><span>${h(servicio ? servicio.nombre : '—')}</span></div>
        <div><span>Atiende</span><span>${h(nombreDe('empleados', c.empleado_id))}</span></div>
        <div><span>Fecha</span><span>${h(Fmt.fecha(c.fecha))}</span></div>
        <div><span>Hora</span><span>${Fmt.hora(c.hora_inicio)} a ${Fmt.hora(c.hora_fin)}</span></div>
        <div><span>Estado</span><span><span class="etiqueta ${clase}">${texto}</span></span></div>
        ${c.notas ? `<div><span>Notas</span><span>${h(c.notas)}</span></div>` : ''}
        ${c.motivo_cancelacion ? `<div><span>Motivo</span><span>${h(c.motivo_cancelacion)}</span></div>` : ''}
      </div>
      ${editable ? `<div class="fila mt">
        ${c.estado === 'Pendiente' ? '<button class="btn chico suave" data-a="confirmar"><i class="bi bi-check2"></i> Confirmar</button>' : ''}
        <button class="btn chico suave" data-a="editar"><i class="bi bi-pencil"></i> Cambiar</button>
        <button class="btn chico suave" data-a="noasistio"><i class="bi bi-person-x"></i> No asistió</button>
        <button class="btn chico suave" data-a="cancelar" style="color:var(--rojo)"><i class="bi bi-x-circle"></i> Cancelar cita</button>
      </div>` : ''}`;

    const botones = [];
    if (tel && abierta) botones.push({
      texto: 'Recordar por WhatsApp', clase: 'sec', icono: 'whatsapp', accion: () => {
        const msg = `Hola ${c.cliente.nombre}, le recordamos su cita en ${App.config.nombre_negocio} el ${Fmt.fechaLarga(c.fecha)} a las ${Fmt.hora12(c.hora_inicio.slice(0, 5))}` +
          (servicio ? ` para ${servicio.nombre}` : '') + '. ¡Le esperamos!';
        window.open(enlaceWhatsApp(tel, msg), '_blank');
        return false;
      }
    });
    if (editable && puede(MOSTRADOR)) botones.push({ texto: 'Cobrar', icono: 'cart-check', accion: () => { location.hash = '#/cobrar?cita=' + c.id; } });
    if (!botones.length) botones.push({ texto: 'Cerrar', clase: 'sec' });
    const m = UI.modal({ titulo: 'Cita', cuerpo, botones, sinFoco: true });

    const cambiar = async (cambios, aviso) => {
      try { await q(sb.from('citas').update(cambios).eq('id', c.id)); UI.ok(aviso); m.cerrar(); recargar(); }
      catch (e) { UI.error(e); }
    };
    m.cuerpo.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'confirmar') cambiar({ estado: 'Confirmada' }, 'Cita confirmada.');
      if (a === 'editar') { m.cerrar(); this.formulario(c, recargar); }
      if (a === 'noasistio' && await UI.confirmar('¿Marcar que el cliente no se presentó?', { si: 'Sí, no asistió' })) cambiar({ estado: 'No_Asistio' }, 'Cita marcada.');
      if (a === 'cancelar') {
        const v = await UI.pedir('Cancelar cita', [{ n: 'motivo', t: 'Motivo (opcional)', ancho: true }], { boton: 'Cancelar la cita' });
        if (v) cambiar({ estado: 'Cancelada', motivo_cancelacion: v.motivo }, 'Cita cancelada.');
      }
    });
  },

  /** Crear o cambiar una cita. */
  formulario(c, recargar) {
    const nueva = !c.id;
    let cliente = c.cliente || null;
    const ini = Fmt.minutos(App.config.hora_apertura.slice(0, 5));
    const fin = Fmt.minutos(App.config.hora_cierre.slice(0, 5));
    const horas = [];
    for (let m = Math.min(ini, 360); m <= Math.max(fin, 1260); m += 15) horas.push(Fmt.hhmm(m));
    const horaIni = (c.hora_inicio || App.config.hora_apertura).slice(0, 5);
    const servicioSel = App.datos.servicios.find(s => s.id === c.servicio_id);
    const duracion = c.hora_fin ? Fmt.minutos(c.hora_fin.slice(0, 5)) - Fmt.minutos(horaIni) : (servicioSel ? servicioSel.duracion_min : 60);
    const duraciones = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
    if (!duraciones.includes(duracion)) duraciones.push(duracion);
    duraciones.sort((a, b) => a - b);

    const cuerpo = document.createElement('div');
    cuerpo.innerHTML = `
      <div class="campo"><label>Cliente</label><div id="cf-cliente"></div></div>
      <div class="campos">
        <div class="campo ancho"><label for="cf-serv">Servicio</label><select id="cf-serv"><option value="">— Elegir —</option>
          ${App.datos.servicios.filter(s => s.activo || s.id === c.servicio_id).map(s =>
            `<option value="${s.id}" ${s.id === c.servicio_id ? 'selected' : ''}>${h(s.nombre)} (${s.duracion_min} min)</option>`).join('')}</select></div>
        <div class="campo ancho"><label for="cf-emp">¿Quién atiende?</label><select id="cf-emp"><option value="">— Elegir —</option>${opcionesEmpleados(c.empleado_id)}</select></div>
        <div class="campo"><label for="cf-fecha">Fecha</label><input id="cf-fecha" type="date" value="${h(c.fecha || Agenda.fecha)}"></div>
        <div class="campo"><label for="cf-hora">Hora</label><select id="cf-hora">${horas.map(x => `<option value="${x}" ${x === horaIni ? 'selected' : ''}>${Fmt.hora12(x)}</option>`).join('')}</select></div>
        <div class="campo ancho"><label for="cf-dur">Duración</label><select id="cf-dur">${duraciones.map(d =>
          `<option value="${d}" ${d === duracion ? 'selected' : ''}>${d < 60 ? d + ' min' : Math.floor(d / 60) + ' h' + (d % 60 ? ' ' + d % 60 + ' min' : '')}</option>`).join('')}</select></div>
        <div class="campo ancho"><label for="cf-notas">Notas</label><textarea id="cf-notas" placeholder="Ej. trae su propio tinte">${h(c.notas || '')}</textarea></div>
      </div>`;
    cuerpo.querySelector('#cf-cliente').appendChild(selectorCliente({ valor: cliente, permitirMostrador: false, onElegir: x => { cliente = x; } }));
    cuerpo.querySelector('#cf-serv').onchange = (ev) => {
      const s = App.datos.servicios.find(x => String(x.id) === ev.target.value);
      if (!s) return;
      const sel = cuerpo.querySelector('#cf-dur');
      if (![...sel.options].some(o => Number(o.value) === s.duracion_min)) sel.add(new Option(s.duracion_min + ' min', s.duracion_min));
      sel.value = s.duracion_min;
    };

    UI.modal({
      titulo: nueva ? 'Nueva cita' : 'Cambiar cita', cuerpo,
      botones: [
        { texto: 'Cancelar', clase: 'sec' },
        {
          texto: nueva ? 'Agendar' : 'Guardar cambios', icono: 'calendar-check', accion: async () => {
            const emp = cuerpo.querySelector('#cf-emp').value;
            const fecha = cuerpo.querySelector('#cf-fecha').value;
            const hora = cuerpo.querySelector('#cf-hora').value;
            const dur = Number(cuerpo.querySelector('#cf-dur').value);
            if (!cliente) throw new Error('Elija o registre el cliente.');
            if (!emp) throw new Error('Elija quién atiende.');
            if (!fecha) throw new Error('Elija la fecha.');
            const finMin = Fmt.minutos(hora) + dur;
            if (finMin >= 24 * 60) throw new Error('La cita termina después de medianoche.');
            const datos = {
              cliente_id: cliente.id, empleado_id: Number(emp), fecha,
              servicio_id: Number(cuerpo.querySelector('#cf-serv').value) || null,
              hora_inicio: hora, hora_fin: Fmt.hhmm(finMin),
              notas: cuerpo.querySelector('#cf-notas').value.trim()
            };
            if (nueva) await q(sb.from('citas').insert(datos));
            else await q(sb.from('citas').update(datos).eq('id', c.id));
            UI.ok(nueva ? 'Cita agendada.' : 'Cita actualizada.');
            Agenda.fecha = fecha;
            recargar();
          }
        }
      ]
    });
  }
});
