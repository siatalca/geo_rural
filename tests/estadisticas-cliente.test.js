const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../assets/js/estadisticas-carpetas.js');

const ev = (fechaEvento, sucursal = 'Casa Matriz') => ({ fechaEvento, sucursal });

test('groupByPeriod: un mes por columna, con ceros en los meses sin carpetas', () => {
    const result = E.groupByPeriod('2026-01-01', '2026-04-20', {
        ingresos: [ev('2026-01-05T13:00:00.000Z'), ev('2026-01-31T12:00:00.000Z'), ev('2026-03-10')],
        certificadas: [ev('2026-04-02T15:00:00.000Z')]
    });
    assert.equal(result.granularity, 'mes');
    assert.deepEqual(result.rows.map((r) => [r.key, r.label, r.ingresos, r.certificadas]), [
        ['2026-01', 'ene 26', 2, 0],
        ['2026-02', 'feb 26', 0, 0],
        ['2026-03', 'mar 26', 1, 0],
        ['2026-04', 'abr 26', 0, 1]
    ]);
    assert.equal(result.rows[0].title, 'enero 2026');
});

test('groupByPeriod: cruza el cambio de año y suma lo mismo que los registros', () => {
    const ingresos = [ev('2025-11-30'), ev('2025-12-15'), ev('2026-01-01'), ev('2026-01-02')];
    const result = E.groupByPeriod('2025-11-01', '2026-01-31', { ingresos, certificadas: [] });
    assert.deepEqual(result.rows.map((r) => r.label), ['nov 25', 'dic 25', 'ene 26']);
    assert.equal(result.rows.reduce((t, r) => t + r.ingresos, 0), ingresos.length);
});

test('groupByPeriod: 24 meses siguen por mes; 25 o más pasan a trimestre', () => {
    const veinticuatro = E.groupByPeriod('2025-01-01', '2026-12-31', { ingresos: [], certificadas: [] });
    assert.equal(veinticuatro.granularity, 'mes');
    assert.equal(veinticuatro.rows.length, 24);

    const result = E.groupByPeriod('2024-12-10', '2026-12-31', {
        ingresos: [ev('2024-12-10'), ev('2025-02-01'), ev('2025-03-31'), ev('2025-04-01'), ev('2026-12-31')],
        certificadas: [ev('2025-06-15')]
    });
    assert.equal(result.granularity, 'trimestre');
    assert.equal(result.rows[0].key, '2024-T4');
    assert.equal(result.rows[0].label, 'T4 24');
    assert.equal(result.rows.at(-1).key, '2026-T4');
    assert.equal(result.rows.length, 9);
    const byKey = Object.fromEntries(result.rows.map((r) => [r.key, r]));
    assert.equal(byKey['2024-T4'].ingresos, 1);
    assert.equal(byKey['2025-T1'].ingresos, 2);
    assert.equal(byKey['2025-T2'].ingresos, 1);
    assert.equal(byKey['2025-T2'].certificadas, 1);
    assert.equal(byKey['2026-T4'].ingresos, 1);
    assert.equal(byKey['2025-T2'].title, '2.º trimestre 2025');
});

test('groupByPeriod: una fecha fuera del rango lo amplía en vez de perderse', () => {
    const result = E.groupByPeriod('2026-03-01', '2026-03-31', { ingresos: [ev('2026-02-28'), ev('2026-03-05')], certificadas: [] });
    assert.deepEqual(result.rows.map((r) => [r.key, r.ingresos]), [['2026-02', 1], ['2026-03', 1]]);
});

test('groupByPeriod: rechaza rango o fechaEvento inválidos', () => {
    assert.throws(() => E.groupByPeriod('', '2026-01-01', { ingresos: [] }), /Rango/);
    assert.throws(() => E.groupByPeriod('2026-01-01', '2026-02-01', { ingresos: [ev('no es fecha')] }), /Fecha inválida en ingresos/);
});

test('groupBySede: cuenta por sede, ordena por total y agrupa la sede vacía', () => {
    const rows = E.groupBySede({
        fueraPlazo: [ev('2026-01-01', 'Sucursal Linares'), ev('2026-01-01', 'Casa Matriz'), ev('2026-01-01', 'Casa Matriz'), ev('2026-01-01', '  ')],
        hallazgos: [ev('2026-01-01', 'Sucursal Chillan'), ev('2026-01-01', 'Casa Matriz'), ev('2026-01-01', 'Sucursal Linares')]
    });
    assert.deepEqual(rows.map((r) => [r.label, r.fueraPlazo, r.hallazgos]), [
        ['Casa Matriz', 2, 1],
        ['Sucursal Linares', 1, 1],
        ['Sin sede', 1, 0],
        ['Sucursal Chillan', 0, 1]
    ]);
});

test('groupBySede: sin registros no hay filas', () => {
    assert.deepEqual(E.groupBySede({ fueraPlazo: [], hallazgos: [] }), []);
});

test('labelStep: escribe todas las etiquetas si caben y salta si no', () => {
    assert.equal(E.labelStep(11, 700), 1);
    assert.equal(E.labelStep(24, 300), 4);
    assert.equal(E.labelStep(12, 300), 2);
    assert.equal(E.labelStep(1, 10), 1);
});

test('describePeriods y describeSedes: resumen en texto con los totales', () => {
    const periodos = E.groupByPeriod('2026-01-01', '2026-03-31', {
        ingresos: [ev('2026-01-05'), ev('2026-03-01'), ev('2026-03-02')],
        certificadas: [ev('2026-02-10')]
    });
    assert.equal(E.describePeriods(periodos),
        '3 meses: 3 ingresadas y 1 certificadas. Más ingresos: marzo 2026 (2). Más certificadas: febrero 2026 (1).');
    assert.equal(E.describePeriods(E.groupByPeriod('2026-01-01', '2026-01-31', { ingresos: [], certificadas: [] })),
        'Sin carpetas ingresadas ni certificadas en el rango.');
    const sedes = E.groupBySede({ fueraPlazo: [ev('2026-01-01', 'Casa Matriz')], hallazgos: [] });
    assert.equal(E.describeSedes(sedes), 'Fuera de plazo: Casa Matriz 1. Con hallazgos: ninguna.');
    assert.equal(E.describeSedes([]), 'Sin carpetas fuera de plazo ni con hallazgos en el rango.');
});
