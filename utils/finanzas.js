/**
 * Cálculo del reporte financiero a partir del DINERO REAL registrado.
 *
 * No cambia la base de datos: solo lee lo que ya existe.
 *
 *  - Mensualidad cobrada = fila de `pagos_mensuales` con estado 'confirmado'.
 *    Se usa `monto` tal cual está (incluye los montos editados desde
 *    "Pagos mensuales": medio mes, pagos parciales, descuentos).
 *  - Matrícula cobrada = inscripción ya confirmada (no 'pendiente') de un alumno con
 *    pago confirmado y `matricula_pagada = 1`. Monto = `deportes.matricula`.
 *    Si se exonera (matricula_pagada = 0) no se suma.
 *  - Fecha de la matrícula = `inscripciones.fecha_inscripcion`.
 *  - Período de una mensualidad = el mes/año al que corresponde el pago
 *    (`pagos_mensuales.mes` y año), igual que en "Pagos mensuales".
 *  - "Hoy" = mensualidades confirmadas con fecha_pago de hoy + matrículas de
 *    inscripciones registradas hoy.
 *
 * Reparto por deporte (pagos_mensuales no guarda el deporte):
 *  1. Si el pago dice "Confirmado solo: X, Y" o "Pendiente: X" (lo escribe el
 *     modal de confirmación parcial), se reparte solo entre esos deportes.
 *  2. Si no, se reparte entre las inscripciones activas del alumno según su
 *     tarifa mensual (si no tiene activas, entre las que tuvo).
 *  3. Sin inscripciones: "Sin deporte asignado".
 *  El reparto siempre suma exactamente el monto del pago, así todo cuadra.
 */

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const SIN_DEPORTE = 'Sin deporte asignado';

const sinTildes = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Número de mes 1–12 a partir del texto guardado ('setiembre' y 'septiembre' = 9). */
export function numeroMes(texto) {
  const t = sinTildes(texto);
  if (!t) return 0;
  if (t === 'setiembre') return 9;
  const i = MESES.indexOf(t);
  if (i >= 0) return i + 1;
  const n = parseInt(t, 10);
  return n >= 1 && n <= 12 ? n : 0;
}

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const redondear = (n) => Math.round(n * 100) / 100;

/** Reparte `monto` según pesos, en céntimos, para que la suma sea exacta. */
function repartir(monto, pesos) {
  const centimos = Math.round(monto * 100);
  const total = pesos.reduce((s, p) => s + p, 0);
  const base = total > 0 ? pesos : pesos.map(() => 1);
  const totalBase = base.reduce((s, p) => s + p, 0);
  const partes = base.map((p) => Math.floor((centimos * p) / totalBase));
  let resto = centimos - partes.reduce((s, p) => s + p, 0);
  for (let i = 0; resto > 0 && i < partes.length; i++, resto--) partes[i] += 1;
  return partes.map((c) => c / 100);
}

/** Deportes nombrados en observaciones del tipo "Confirmado solo: A, B" o "Pendiente: A". */
function deportesEnObservacion(obs) {
  const m = String(obs || '').match(/(?:confirmado solo|pendiente)\s*:\s*(.+)$/i);
  if (!m) return null;
  return m[1].split(',').map((x) => sinTildes(x)).filter(Boolean);
}

/**
 * @param {object} p
 * @param {Array} p.pagos        filas de pagos_mensuales (confirmado y pendiente)
 * @param {Array} p.inscripciones filas de inscripciones + deporte
 * @param {Array} p.alumnos      filas de alumnos
 * @param {object} p.filtros     { mes, anio, deporte } (opcionales)
 * @param {string} p.hoy         'YYYY-MM-DD' según la base de datos
 */
export function calcularReporteFinanciero({ pagos = [], inscripciones = [], alumnos = [], filtros = {}, hoy }) {
  const [anioHoy, mesHoy] = String(hoy || new Date().toISOString().slice(0, 10)).split('-').map((x) => parseInt(x, 10));
  const claveHoy = anioHoy * 100 + mesHoy;

  const filtroMes = filtros.mes ? numeroMes(filtros.mes) : 0;
  const filtroAnio = filtros.anio ? parseInt(filtros.anio, 10) || 0 : 0;
  const filtroDeporte = filtros.deporte ? sinTildes(filtros.deporte) : '';
  const hayFiltros = Boolean(filtroMes || filtroAnio || filtroDeporte);
  const enPeriodo = (mes, anio) => (!filtroMes || mes === filtroMes) && (!filtroAnio || anio === filtroAnio);

  // ---------- Índices ----------
  const alumnoPorId = new Map(alumnos.map((a) => [String(a.alumno_id), a]));
  const inscPorAlumno = new Map();
  const nombreDeporte = new Map(); // clave sin tildes -> nombre original
  for (const i of inscripciones) {
    const k = String(i.alumno_id);
    if (!inscPorAlumno.has(k)) inscPorAlumno.set(k, []);
    inscPorAlumno.get(k).push(i);
    if (i.deporte) nombreDeporte.set(sinTildes(i.deporte), i.deporte);
  }
  const nombreDe = (clave) => nombreDeporte.get(clave) || clave;

  // ---------- Matrículas cobradas ----------
  const matriculas = [];
  for (const i of inscripciones) {
    const alumno = alumnoPorId.get(String(i.alumno_id));
    const confirmada = i.estado && i.estado !== 'pendiente';
    const alumnoPago = !alumno || !alumno.estado_pago || alumno.estado_pago === 'confirmado';
    if (!confirmada || !alumnoPago || Number(i.matricula_pagada) !== 1) continue;
    const monto = num(i.matricula_deporte);
    if (monto <= 0) continue;
    const [a, m] = String(i.fecha_dia || '').split('-').map((x) => parseInt(x, 10));
    matriculas.push({
      alumno_id: String(i.alumno_id),
      deporte: sinTildes(i.deporte),
      monto,
      anio: a || 0,
      mes: m || 0,
      dia: i.fecha_dia || '',
    });
  }

  // ---------- Mensualidades (con reparto por deporte) ----------
  const cobradas = [];
  const pendientes = [];
  for (const p of pagos) {
    const mes = numeroMes(p.mes);
    const anio = parseInt(p.anio, 10) || 0;
    const monto = num(p.monto);
    const fila = { pago_id: p.pago_id, alumno_id: String(p.alumno_id), mes, anio, monto, dia: p.fecha_pago_dia || '' };
    if (p.estado === 'pendiente') {
      pendientes.push(fila);
      continue;
    }
    if (p.estado !== 'confirmado') continue;

    const insc = inscPorAlumno.get(fila.alumno_id) || [];
    const nombrados = deportesEnObservacion(p.observaciones);
    let destino = [];
    if (nombrados && nombrados.length) {
      destino = nombrados.map((d) => {
        const ins = insc.find((x) => sinTildes(x.deporte) === d);
        return { deporte: d, peso: ins ? num(ins.precio_mensual) : 0 };
      });
    }
    if (!destino.length) {
      let base = insc.filter((x) => x.estado === 'activa');
      if (!base.length) base = insc.filter((x) => x.estado !== 'pendiente');
      if (!base.length) base = insc;
      destino = base.map((x) => ({ deporte: sinTildes(x.deporte), peso: num(x.precio_mensual) }));
    }
    if (!destino.length) destino = [{ deporte: sinTildes(SIN_DEPORTE), peso: 1 }];
    const partes = repartir(monto, destino.map((d) => d.peso));
    fila.reparto = destino.map((d, idx) => ({ deporte: d.deporte, monto: partes[idx] }));
    cobradas.push(fila);
  }
  nombreDeporte.set(sinTildes(SIN_DEPORTE), SIN_DEPORTE);

  // ---------- Resumen general (sin filtros) ----------
  const suma = (arr, f = (x) => x.monto) => redondear(arr.reduce((s, x) => s + f(x), 0));
  const totalMensualidades = suma(cobradas);
  const totalMatriculas = suma(matriculas);
  const mensualidadesMes = suma(cobradas.filter((p) => p.anio * 100 + p.mes === claveHoy));
  const matriculasMes = suma(matriculas.filter((m) => m.anio * 100 + m.mes === claveHoy));
  const mensualidadesHoy = suma(cobradas.filter((p) => p.dia === hoy));
  const matriculasHoy = suma(matriculas.filter((m) => m.dia === hoy));
  const pendienteMes = suma(pendientes.filter((p) => p.anio * 100 + p.mes === claveHoy));

  const activas = inscripciones.filter((i) => i.estado === 'activa');
  const alumnosActivos = new Set(
    activas.filter((i) => (alumnoPorId.get(String(i.alumno_id))?.estado || 'activo') === 'activo').map((i) => String(i.alumno_id))
  );
  const tarifaMensualActiva = suma(activas, (i) => num(i.precio_mensual));

  // ---------- Vista del período (filtros) ----------
  const cobradasPeriodo = cobradas.filter((p) => enPeriodo(p.mes, p.anio));
  const matriculasPeriodo = matriculas.filter(
    (m) => enPeriodo(m.mes, m.anio) && (!filtroDeporte || m.deporte === filtroDeporte)
  );
  const partesPeriodoTodas = [];
  for (const p of cobradasPeriodo) {
    for (const r of p.reparto) partesPeriodoTodas.push({ ...r, alumno_id: p.alumno_id, pago_id: p.pago_id });
  }
  const partesPeriodo = partesPeriodoTodas.filter((r) => !filtroDeporte || r.deporte === filtroDeporte);
  const matriculasPeriodoTodas = matriculas.filter((m) => enPeriodo(m.mes, m.anio));

  let resumenFiltrado = null;
  if (hayFiltros) {
    const montoMens = suma(partesPeriodo);
    const montoMat = suma(matriculasPeriodo);
    resumenFiltrado = {
      totalMonto: redondear(montoMens + montoMat),
      montoMensualidades: montoMens,
      montoMatriculas: montoMat,
      cantidadPagos: new Set(partesPeriodo.map((x) => x.pago_id)).size,
      cantidadAlumnos: new Set([...partesPeriodo.map((x) => x.alumno_id), ...matriculasPeriodo.map((m) => m.alumno_id)]).size,
      filtros: { mes: filtros.mes || null, anio: filtroAnio || null, deporte: filtros.deporte || null },
    };
  }

  // ---------- Por deporte (período) ----------
  const porDeporteMap = new Map();
  const dep = (clave) => {
    if (!porDeporteMap.has(clave)) {
      porDeporteMap.set(clave, { clave, deporte: nombreDe(clave), totalInscritos: 0, matriculas: 0, mensualidades: 0, tarifaMensual: 0 });
    }
    return porDeporteMap.get(clave);
  };
  for (const i of activas) {
    const d = dep(sinTildes(i.deporte));
    d.totalInscritos += 1;
    d.tarifaMensual += num(i.precio_mensual);
  }
  for (const r of partesPeriodoTodas) dep(r.deporte).mensualidades += r.monto;
  for (const m of matriculasPeriodoTodas) dep(m.deporte).matriculas += m.monto;
  // Por deporte se filtra solo por período (no por deporte) para poder comparar deportes.
  const porDeporte = [...porDeporteMap.values()]
    .map((d) => ({
      deporte: d.deporte,
      totalInscritos: d.totalInscritos,
      matriculas: redondear(d.matriculas),
      mensualidades: redondear(d.mensualidades),
      total: redondear(d.matriculas + d.mensualidades),
      tarifaMensual: redondear(d.tarifaMensual),
    }))
    .sort((a, b) => b.total - a.total || b.tarifaMensual - a.tarifaMensual);

  // ---------- Por alumno (período) ----------
  const porAlumnoMap = new Map();
  const alu = (id) => {
    if (!porAlumnoMap.has(id)) porAlumnoMap.set(id, { id, matriculas: 0, mensualidades: 0, pagos: new Set() });
    return porAlumnoMap.get(id);
  };
  for (const r of partesPeriodo) {
    const a = alu(r.alumno_id);
    a.mensualidades += r.monto;
    a.pagos.add(r.pago_id);
  }
  for (const m of matriculasPeriodo) alu(m.alumno_id).matriculas += m.monto;
  const porAlumnoCompleto = [...porAlumnoMap.values()].map((a) => {
    const al = alumnoPorId.get(a.id) || {};
    const insc = inscPorAlumno.get(a.id) || [];
    const act = insc.filter((i) => i.estado === 'activa');
    const inactivos = insc.filter((i) => i.estado === 'cancelada' || i.estado === 'suspendida');
    return {
      dni: al.dni || '',
      nombres: [al.nombres, al.apellido_paterno, al.apellido_materno].filter(Boolean).join(' ').trim() || `Alumno ${a.id}`,
      telefono: al.telefono || '',
      cantidadDeportes: act.length,
      deportes: act.map((i) => i.deporte),
      deportesInactivos: [...new Set(inactivos.map((i) => i.deporte))].filter((d) => !act.some((x) => x.deporte === d)),
      matriculas: redondear(a.matriculas),
      mensualidades: redondear(a.mensualidades),
      total: redondear(a.matriculas + a.mensualidades),
      cantidadPagos: a.pagos.size,
      tarifaMensual: redondear(act.reduce((s, i) => s + num(i.precio_mensual), 0)),
    };
  }).filter((a) => a.total > 0)
    .sort((a, b) => b.total - a.total || a.nombres.localeCompare(b.nombres, 'es'));

  // ---------- Desglose por mes y deporte (sin filtros de período) ----------
  const desgloseMap = new Map();
  for (const p of cobradas) {
    if (!p.mes || !p.anio) continue;
    for (const r of p.reparto) {
      const k = `${p.anio}-${p.mes}-${r.deporte}`;
      if (!desgloseMap.has(k)) desgloseMap.set(k, { mes: MESES[p.mes - 1], anio: p.anio, deporte: nombreDe(r.deporte), pagos: new Set(), monto: 0 });
      const g = desgloseMap.get(k);
      g.pagos.add(p.pago_id);
      g.monto += r.monto;
    }
  }
  const desgloseMensual = [...desgloseMap.values()]
    .map((g) => ({ mes: g.mes, anio: g.anio, deporte: g.deporte, cantidad_pagos: g.pagos.size, total_recaudado: redondear(g.monto) }))
    .sort((a, b) => b.anio - a.anio || numeroMes(b.mes) - numeroMes(a.mes) || b.total_recaudado - a.total_recaudado);

  // Pagos confirmados sin mes/año reconocible: se informan para que nada se pierda.
  const sinPeriodo = suma(cobradas.filter((p) => !p.mes || !p.anio));

  return {
    resumen: {
      totalAlumnosActivos: alumnosActivos.size,
      totalInscripcionesActivas: activas.length,
      totalMatriculas,
      totalMensualidades,
      totalIngresosActivos: redondear(totalMatriculas + totalMensualidades),
      ingresosMes: redondear(mensualidadesMes + matriculasMes),
      mensualidadesMes,
      matriculasMes,
      ingresosHoy: redondear(mensualidadesHoy + matriculasHoy),
      mensualidadesHoy,
      matriculasHoy,
      pendienteMes,
      tarifaMensualActiva,
      mensualidadesSinPeriodo: sinPeriodo,
      mesActual: MESES[mesHoy - 1],
      anioActual: anioHoy,
    },
    porDeporte,
    resumenFiltrado,
    desgloseMensual,
    porAlumno: porAlumnoCompleto.slice(0, 50),
    totalAlumnosConPagos: porAlumnoCompleto.length,
    criterio: 'dinero-real-v2',
  };
}
