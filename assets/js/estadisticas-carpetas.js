// Pestaña ESTADÍSTICAS DE CARPETAS del supervisor: agrupa los registros de los reportes (GET /api/reportes/:tipo)
// por mes (o trimestre) de fechaEvento y por sede, y arma los resúmenes en texto de cada gráfico.
// Lógica pura (sin DOM). Las fechas se leen con parseDate de reportes-impresion.js, la misma que valida el contrato.
(function (root, factory) {
    const reportes = typeof module === 'object' && module.exports
        ? require('./reportes-impresion.js')
        : root.SiaReportes;
    const api = factory(reportes);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SiaEstadisticas = api;
})(typeof window !== 'undefined' ? window : globalThis, function (reportes) {
    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
        'octubre', 'noviembre', 'diciembre'];
    // Sobre 24 meses las columnas mensuales no se leen: se agrupa por trimestre.
    const MAX_MESES = 24;
    const SIN_SEDE = 'Sin sede';

    function monthIndex(value) {
        const parts = reportes.parseDate(value);
        return parts ? Number(parts.y) * 12 + Number(parts.m) - 1 : null;
    }

    // series: { nombre: registros }. Devuelve { granularity: 'mes' | 'trimestre', rows: [{ key, label, title, <nombre>: n }] }.
    // Cubre todo el rango desde..hasta con ceros en los períodos sin carpetas. Si una fechaEvento cae fuera del rango,
    // el rango se amplía hasta ella: ninguna carpeta queda fuera de las columnas (los totales siempre calzan).
    function groupByPeriod(desde, hasta, series) {
        const start = monthIndex(desde);
        const end = monthIndex(hasta);
        if (start === null || end === null) throw new Error('Rango de fechas inválido.');
        const names = Object.keys(series);
        let lo = Math.min(start, end);
        let hi = Math.max(start, end);
        const events = {};
        names.forEach((name) => {
            events[name] = (Array.isArray(series[name]) ? series[name] : []).map((row) => {
                const index = monthIndex(row && row.fechaEvento);
                if (index === null) throw new Error(`Fecha inválida en ${name}.`);
                lo = Math.min(lo, index);
                hi = Math.max(hi, index);
                return index;
            });
        });
        const quarterly = hi - lo + 1 > MAX_MESES;
        // Trimestre: año * 4 + (mes 0..11) / 3, con la misma división entera.
        const keyOf = (index) => (quarterly ? Math.floor(index / 3) : index);
        const first = keyOf(lo);
        const rows = [];
        for (let key = first; key <= keyOf(hi); key += 1) {
            const year = Math.floor(key / (quarterly ? 4 : 12));
            const sub = key % (quarterly ? 4 : 12);
            const shortYear = String(year).slice(2);
            const row = quarterly
                ? { key: `${year}-T${sub + 1}`, label: `T${sub + 1} ${shortYear}`, title: `${sub + 1}.º trimestre ${year}` }
                : { key: `${year}-${String(sub + 1).padStart(2, '0')}`, label: `${MESES[sub]} ${shortYear}`, title: `${MESES_LARGOS[sub]} ${year}` };
            names.forEach((name) => { row[name] = 0; });
            rows.push(row);
        }
        names.forEach((name) => events[name].forEach((index) => { rows[keyOf(index) - first][name] += 1; }));
        return { granularity: quarterly ? 'trimestre' : 'mes', rows };
    }

    // series: { nombre: registros }. Una fila por sede con la cantidad de cada serie,
    // de la sede con más carpetas a la con menos (empate: orden alfabético).
    function groupBySede(series) {
        const names = Object.keys(series);
        const bySede = new Map();
        names.forEach((name) => {
            (Array.isArray(series[name]) ? series[name] : []).forEach((row) => {
                const label = String((row && row.sucursal) || '').trim() || SIN_SEDE;
                if (!bySede.has(label)) bySede.set(label, Object.fromEntries([['label', label], ...names.map((n) => [n, 0])]));
                bySede.get(label)[name] += 1;
            });
        });
        const sum = (row) => names.reduce((total, name) => total + row[name], 0);
        return Array.from(bySede.values()).sort((a, b) => sum(b) - sum(a) || a.label.localeCompare(b.label, 'es'));
    }

    // Cada cuántas columnas se escribe la etiqueta del eje para que no se encimen (minPx por etiqueta).
    function labelStep(count, plotWidth, minPx = 44) {
        const fit = Math.max(1, Math.floor(plotWidth / minPx));
        return Math.max(1, Math.ceil(count / fit));
    }

    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    function peak(rows, name) {
        return rows.reduce((best, row) => (row[name] > (best ? best[name] : 0) ? row : best), null);
    }

    // Resumen en texto del gráfico por período (rows de groupByPeriod con ingresos y certificadas).
    function describePeriods({ granularity, rows }) {
        const ingresos = rows.reduce((t, r) => t + r.ingresos, 0);
        const certificadas = rows.reduce((t, r) => t + r.certificadas, 0);
        if (!ingresos && !certificadas) return 'Sin carpetas ingresadas ni certificadas en el rango.';
        const unit = granularity === 'trimestre' ? ['trimestre', 'trimestres'] : ['mes', 'meses'];
        const parts = [`${plural(rows.length, ...unit)}: ${ingresos} ingresadas y ${certificadas} certificadas.`];
        const maxIngresos = peak(rows, 'ingresos');
        const maxCertificadas = peak(rows, 'certificadas');
        if (maxIngresos) parts.push(`Más ingresos: ${maxIngresos.title} (${maxIngresos.ingresos}).`);
        if (maxCertificadas) parts.push(`Más certificadas: ${maxCertificadas.title} (${maxCertificadas.certificadas}).`);
        return parts.join(' ');
    }

    // Resumen en texto del gráfico por sede (rows de groupBySede con fueraPlazo y hallazgos).
    function describeSedes(rows) {
        const list = (name) => rows.filter((r) => r[name] > 0).map((r) => `${r.label} ${r[name]}`).join(', ') || 'ninguna';
        if (!rows.length) return 'Sin carpetas fuera de plazo ni con hallazgos en el rango.';
        return `Fuera de plazo: ${list('fueraPlazo')}. Con hallazgos: ${list('hallazgos')}.`;
    }

    return { MAX_MESES, SIN_SEDE, groupByPeriod, groupBySede, labelStep, describePeriods, describeSedes };
});
