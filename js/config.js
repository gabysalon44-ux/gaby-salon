/**
 * Datos de conexión a Supabase.
 * Se copian de: Supabase > Project Settings > API.
 *  - SUPABASE_URL:  "Project URL"
 *  - SUPABASE_KEY:  la llave "anon public" (es pública por diseño; la seguridad
 *                   la ponen las reglas de la base de datos, no esta llave).
 * NUNCA pongas aquí la llave "service_role".
 */
window.CONFIG = {
  SUPABASE_URL: 'https://gabysalon44-ux.github.io/gaby-salon/',
  SUPABASE_KEY: 'sb_publishable_igxqc1xWt7pRsZRPfgNEqQ_rv5Yf-GP',

  // Los usuarios entran con nombre de usuario + PIN. Por dentro Supabase
  // necesita un correo: se arma como usuario@DOMINIO. No se envían correos.
  DOMINIO_USUARIOS: 'gabysalon.app'
};
