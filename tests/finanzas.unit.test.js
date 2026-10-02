// Pruebas del reporte financiero (dinero real). Ejecutar: node --test tests/finanzas.unit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularReporteFinanciero, numeroMes } from '../utils/finanzas.js';

const HOY = '2026-09-18';

// Casos tomados de lo que reporta administración (nombres ficticios).
const alumnos = [
  { alumno_id: 1, dni: '11111111', nombres: 'Carlos', apellido_paterno: 'Sanchez', estado: 'activo', estado_pago: 'confirmado' },
  { alumno_id: 2, dni: '22222222', nombres: 'Cristian', apellido_paterno: 'Quispe', estado: 'activo', estado_pago: 'confirmado' },
  { alumno_id: 3, dni: '33333333', nombres: 'Mario', apellido_paterno: 'Maguiña', estado: 'activo', estado_pago: 'confirmado' },
  { alumno_id: 4, dni: '44444444', nombres: 'Lucía', apellido_paterno: 'Tardía', estado: 'activo', estado_pago: 'confirmado' },
  { alumno_id: 5, dni: '55555555', nombres: 'Ana', apellido_paterno: 'Pendiente', estado: 'activo', estado_pago: 'pendiente' },
];
const insc = (inscripcion_id, alumno_id, deporte, estado, precio_mensual, matricula_pagada, fecha_dia) => ({
  inscripcion_id, alumno_id, deporte, estado, precio_mensual: String(precio_mensual), matricula_pagada, fecha_dia, matricula_deporte: '20.00',
});
const inscripciones = [
  insc(10, 1, 'Fútbol', 'activa', 120, 1, '2026-03-02'),
  insc(11, 1, 'Vóley', 'cancelada', 120, 1, '2026-03-02'), // deporte inactivo
  insc(20, 2, 'Fútbol', 'activa', 150, 1, '2026-04-01'),
  insc(30, 3, 'Básquet', 'activa', 150, 0, '2026-04-01'), // matrícula exonerada
  insc(40, 4, 'Fútbol', 'activa', 120, 1, '2026-09-15'), // se inscribió en quincena
  insc(50, 5, 'Vóley', 'pendiente', 120, 1, '2026-09-17'), // aún sin confirmar
];
const pago = (pago_id, alumno_id, mes, anio, monto, estado, fecha_pago_dia, observaciones = null) => ({
  pago_id, alumno_id, mes, anio, monto: String(monto), estado, fecha_pago_dia, observaciones,
});
const pagos = [
  pago(1, 1, 'agosto', 2026, 120, 'confirmado', '2026-08-03', 'Confirmado solo: Fútbol'),
  pago(2, 1, 'agosto', 2026, 120, 'pendiente', null, 'Pendiente: Vóley'),
  pago(3, 1, 'septiembre', 2026, 120, 'confirmado', '2026-09-02'),
  pago(4, 2, 'setiembre', 2026, 100, 'confirmado', '2026-09-05'), // pagó 100, tarifa 150
  pago(5, 3, 'septiembre', 2026, 100, 'confirmado', '2026-09-18'), // pagó 100 hoy
  pago(6, 4, 'septiembre', 2026, 60, 'confirmado', '2026-09-15'), // medio mes (monto editado)
  pago(7, 2, 'agosto', 2026, 150, 'rechazado', '2026-08-01'),
];

const r = calcularReporteFinanciero({ pagos, inscripciones, alumnos, hoy: HOY });
const sum = (arr, k) => Math.round(arr.reduce((s, x) => s + x[k], 0) * 100) / 100;

test('usa el monto pagado (editado), no la tarifa del plan', () => {
  const cristian = r.porAlumno.find((a) => a.dni === '22222222');
  assert.equal(cristian.mensualidades, 100);
  assert.equal(cristian.tarifaMensual, 150);
  const lucia = r.porAlumno.find((a) => a.dni === '44444444');
  assert.equal(lucia.mensualidades, 60);
});

test('un deporte inactivo no suma como pagado', () => {
  const carlos = r.porAlumno.find((a) => a.dni === '11111111');
  assert.equal(carlos.mensualidades, 240); // 120 agosto (solo Fútbol) + 120 setiembre
  assert.deepEqual(carlos.deportes, ['Fútbol']);
  assert.deepEqual(carlos.deportesInactivos, ['Vóley']);
  const voley = r.desgloseMensual.find((d) => d.deporte === 'Vóley' && d.mes === 'agosto');
  assert.equal(voley, undefined, 'el pago "Confirmado solo: Fútbol" no se reparte a Vóley');
});

test('matrícula exonerada no se suma y pendientes no cuentan', () => {
  const mario = r.porAlumno.find((a) => a.dni === '33333333');
  assert.equal(mario.matriculas, 0);
  // Carlos (2 inscripciones confirmadas) + Cristian + Lucía = 4 × 20; Ana está pendiente
  assert.equal(r.resumen.totalMatriculas, 80);
});

test('setiembre y septiembre son el mismo mes', () => {
  assert.equal(numeroMes('setiembre'), 9);
  assert.equal(numeroMes('Septiembre'), 9);
  assert.equal(r.resumen.mensualidadesMes, 120 + 100 + 100 + 60);
  assert.equal(r.resumen.matriculasMes, 20); // Lucía se inscribió en setiembre
  assert.equal(r.resumen.ingresosMes, 400);
});

test('hoy suma lo confirmado hoy', () => {
  assert.equal(r.resumen.ingresosHoy, 100);
});

test('todo cuadra: totales = suma por deporte = suma por mes = suma por alumno', () => {
  const { totalMensualidades, totalMatriculas, totalIngresosActivos } = r.resumen;
  assert.equal(totalMensualidades, 120 + 120 + 100 + 100 + 60);
  assert.equal(sum(r.porDeporte, 'mensualidades'), totalMensualidades);
  assert.equal(sum(r.porDeporte, 'matriculas'), totalMatriculas);
  assert.equal(sum(r.desgloseMensual, 'total_recaudado'), totalMensualidades);
  assert.equal(sum(r.porAlumno, 'total'), totalIngresosActivos);
});

test('el filtro de un mes coincide con "Ingresos del mes"', () => {
  const f = calcularReporteFinanciero({ pagos, inscripciones, alumnos, hoy: HOY, filtros: { mes: 'setiembre', anio: '2026' } });
  assert.equal(f.resumenFiltrado.totalMonto, r.resumen.ingresosMes);
  assert.equal(sum(f.porAlumno, 'total'), f.resumenFiltrado.totalMonto);
  assert.equal(sum(f.porDeporte, 'total'), f.resumenFiltrado.totalMonto);
});

test('el filtro por deporte suma solo lo repartido a ese deporte', () => {
  const f = calcularReporteFinanciero({ pagos, inscripciones, alumnos, hoy: HOY, filtros: { deporte: 'Vóley' } });
  assert.equal(f.resumenFiltrado.montoMensualidades, 0);
  assert.equal(f.resumenFiltrado.montoMatriculas, 20);
  assert.ok(f.porDeporte.length > 1, 'por deporte sigue mostrando todos los deportes para comparar');
});

test('un pago repartido entre varios deportes suma exacto', () => {
  const g = calcularReporteFinanciero({
    hoy: HOY,
    alumnos: [{ alumno_id: 9, estado: 'activo', estado_pago: 'confirmado' }],
    inscripciones: [insc(90, 9, 'Fútbol', 'activa', 80, 0, '2026-01-01'), insc(91, 9, 'Vóley', 'activa', 120, 0, '2026-01-01')],
    pagos: [pago(90, 9, 'enero', 2026, 100.01, 'confirmado', '2026-01-05')],
  });
  assert.equal(sum(g.desgloseMensual, 'total_recaudado'), 100.01);
});
