/* Inicio: tarjetas grandes con cada módulo, como en el diseño de referencia. */

vista('inicio', {
  titulo: 'Inicio', icono: 'grid-3x3-gap-fill', menu: true,
  render(cont) {
    const hora = new Date().getHours();
    const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';
    const avisoCaja = puede(MOSTRADOR) && !App.caja
      ? `<div class="aviso ambar mb"><i class="bi bi-lock-fill"></i><span class="crece">La caja está cerrada. Ábrala para empezar a cobrar.</span>
         <button class="btn chico" id="ini-abrir">Abrir caja</button></div>` : '';
    cont.innerHTML = `
      <div class="saludo"><h2>${saludo}, ${h(App.perfil.nombre.split(' ')[0])}</h2>
        <p>${h(Fmt.fechaLarga(Fmt.hoy()))} · ¿Qué desea hacer?</p></div>
      ${avisoCaja}
      <div class="mosaico">
        ${App.vistasPermitidas().filter(v => v.id !== 'inicio').map(v => `
          <a class="tarjeta-modulo" href="#/${v.id}"><i class="bi bi-${v.icono}"></i><span>${h(v.titulo)}</span></a>`).join('')}
      </div>`;
    const b = cont.querySelector('#ini-abrir');
    if (b) b.onclick = async () => { if (await abrirCajaDialogo()) App.navegar(); };
  }
});
