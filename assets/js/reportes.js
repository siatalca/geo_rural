// Menu REPORTES y su ventana (supervisor, secretaria y super; con «VER COMO» rige el rol visto).
// La logica pura (definiciones, contrato y hoja impresa) vive en reportes-impresion.js (window.SiaReportes).
// Usa funciones globales de script.js: apiRequest, escapeHtml, populateRegiones, openSolicitudPrintFrame,
// setFormMessage, canUseReports, currentUser y dateRangeAvailableBranches; y el catalogo de estados de carpeta
// (configuredDocumentGroups y configuredDocumentOptions) para agrupar la hoja de ingresos.
(function () {
    const $ = (id) => document.getElementById(id);
    const R = window.SiaReportes;
    const state = { tipo: '', data: null, requestId: 0 };

    function setMenuOpen(isOpen) {
        const panel = $('reportesMenuPanel');
        const button = $('reportesMenuBtn');
        if (!panel || !button) return;
        panel.classList.toggle('hidden', !isOpen);
        button.setAttribute('aria-expanded', String(isOpen));
    }

    function setPrintEnabled(enabled) {
        const button = $('reporteImprimirBtn');
        if (button) button.disabled = !enabled;
    }

    function clearResult() {
        state.data = null;
        setPrintEnabled(false);
        $('reporteResultado')?.classList.add('hidden');
        const body = $('reporteBody');
        if (body) body.innerHTML = '';
        const resumen = $('reporteResumen');
        if (resumen) resumen.innerHTML = '';
        const facturacion = $('reporteFacturacion');
        if (facturacion) facturacion.innerHTML = '';
        $('reporteFacturacionBloque')?.classList.add('hidden');
    }

    // Etiquetas del catalogo de ESTADO CARPETA en el orden del selector del formulario (grupos y, dentro de cada
    // uno, sus estados). Viene de script.js (configuredDocumentGroups/Options, cargados de /api/carpeta-estados/catalogo).
    // Si no esta disponible devuelve [] y la hoja agrupa solo por los estados presentes.
    function folderStatusLabels() {
        try {
            return R.catalogLabels(
                typeof configuredDocumentGroups !== 'undefined' ? configuredDocumentGroups : [],
                typeof configuredDocumentOptions !== 'undefined' ? configuredDocumentOptions : []);
        } catch (error) {
            return [];
        }
    }

    // select: la lista SEDE a llenar (la de esta ventana o la de ESTADÍSTICAS DE CARPETAS del supervisor).
    function fillBranches(branches, select) {
        if (!select) return;
        // La lista llega despues de abrir: si ya se eligio una sede que sigue existiendo, se conserva.
        const previous = String(select.value || '');
        const options = Array.from(new Set((Array.isArray(branches) ? branches : [])
            .map((item) => String(item || '').trim()).filter(Boolean)))
            .sort((left, right) => left.localeCompare(right, 'es'));
        select.innerHTML = '<option value="">TODAS</option>';
        options.forEach((name) => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });
        select.value = options.includes(previous) ? previous : '';
    }

    // Misma lista de sedes que la busqueda por fecha (/registros/sucursales-disponibles).
    async function loadBranches(select = $('reporteSucursal')) {
        try {
            const data = await apiRequest('/registros/sucursales-disponibles');
            fillBranches(Array.isArray(data?.sucursales) ? data.sucursales : [], select);
        } catch (error) {
            fillBranches(typeof dateRangeAvailableBranches !== 'undefined' ? dateRangeAvailableBranches : [], select);
        }
    }

    function renderHead(tipo) {
        const head = $('reporteHead');
        if (!head) return;
        head.innerHTML = '';
        R.columnsFor(tipo).forEach((name) => {
            const th = document.createElement('th');
            th.textContent = name;
            head.appendChild(th);
        });
    }

    function renderResult(tipo, data) {
        $('reporteTotal').textContent = `Total: ${R.totalLabel(data.total)}`;
        const resumen = $('reporteResumen');
        resumen.innerHTML = '';
        data.resumen.forEach((item) => {
            const li = document.createElement('li');
            li.textContent = `${item.etiqueta}: ${item.cantidad}`;
            resumen.appendChild(li);
        });
        resumen.classList.toggle('hidden', data.resumen.length === 0);
        // Solo «ingresos» trae resumenFacturacion (ya validado); en los otros reportes el bloque queda oculto.
        const facturacion = $('reporteFacturacion');
        facturacion.innerHTML = '';
        const billing = tipo === 'ingresos' && Array.isArray(data.resumenFacturacion) ? data.resumenFacturacion : [];
        const withAmounts = R.billingHasAmounts(billing);
        billing.forEach((item) => {
            const li = document.createElement('li');
            li.textContent = R.billingItemLabel(item, withAmounts);
            facturacion.appendChild(li);
        });
        $('reporteFacturacionBloque').classList.toggle('hidden', billing.length === 0);
        const body = $('reporteBody');
        body.innerHTML = '';
        if (!data.registros.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = R.columnsFor(tipo).length;
            td.textContent = 'Sin carpetas para el rango y los filtros elegidos.';
            tr.appendChild(td);
            body.appendChild(tr);
        }
        data.registros.forEach((row) => {
            const tr = document.createElement('tr');
            R.rowCells(row, tipo).forEach((cell) => {
                const td = document.createElement('td');
                td.textContent = cell;
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });
        $('reporteResultado').classList.remove('hidden');
    }

    async function search() {
        const message = $('reporteMessage');
        const tipo = state.tipo;
        clearResult();
        if (!canUseReports(currentUser)) {
            setFormMessage(message, 'Tu rol no puede consultar reportes.', 'error');
            return;
        }
        const desde = String($('reporteDesde').value || '').trim();
        const hasta = String($('reporteHasta').value || '').trim();
        if (!desde || !hasta) {
            setFormMessage(message, 'Indica las fechas DESDE y HASTA (dia, mes y año completos).', 'error');
            (!desde ? $('reporteDesde') : $('reporteHasta')).focus();
            return;
        }
        const query = new URLSearchParams({
            desde,
            hasta,
            region: String($('reporteRegion').value || '').trim(),
            sucursal: String($('reporteSucursal').value || '').trim()
        });
        const requestId = ++state.requestId;
        const button = $('reporteBuscarBtn');
        button.disabled = true;
        setFormMessage(message, 'Buscando...', '');
        try {
            const payload = await apiRequest(`/reportes/${encodeURIComponent(tipo)}?${query.toString()}`);
            if (requestId !== state.requestId || tipo !== state.tipo) return;
            const checked = R.validateResponse(payload, tipo);
            if (!checked.ok) {
                setFormMessage(message, checked.error, 'error');
                return;
            }
            state.data = checked.data;
            renderResult(tipo, checked.data);
            setPrintEnabled(checked.data.total > 0);
            setFormMessage(message, checked.data.total > 0 ? '' : 'No hay carpetas para el rango y los filtros elegidos.', '');
        } catch (error) {
            if (requestId !== state.requestId) return;
            setFormMessage(message, error?.message || 'No fue posible generar el reporte.', 'error');
        } finally {
            if (requestId === state.requestId) button.disabled = false;
        }
    }

    function print() {
        const message = $('reporteMessage');
        const data = state.data;
        if (!data || !data.total || data.tipo !== state.tipo) {
            setFormMessage(message, 'Primero busca y obtén carpetas para imprimir.', 'error');
            return;
        }
        const printedAt = new Date().toLocaleString('es-CL', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
        });
        const estados = state.tipo === 'ingresos' ? folderStatusLabels() : [];
        openSolicitudPrintFrame(R.buildPrintHtml({ tipo: state.tipo, data, printedAt, estados }, escapeHtml));
    }

    function open(tipo) {
        const report = R.getReport(tipo);
        if (!report || !canUseReports(currentUser)) return;
        state.tipo = tipo;
        state.requestId += 1;
        $('reporteTitle').textContent = report.title;
        $('reporteDescription').textContent = report.description;
        const range = R.defaultRange();
        $('reporteDesde').value = range.desde;
        $('reporteHasta').value = range.hasta;
        populateRegiones($('reporteRegion'), 'TODAS');
        $('reporteRegion').value = '';
        $('reporteSucursal').value = '';
        $('reporteBuscarBtn').disabled = false;
        renderHead(tipo);
        clearResult();
        setFormMessage($('reporteMessage'), '', '');
        $('reporteOverlay').classList.remove('hidden');
        window.requestAnimationFrame(() => $('reporteDesde').focus());
        void loadBranches();
    }

    function close() {
        state.requestId += 1;
        setMenuOpen(false);
        const overlay = $('reporteOverlay');
        if (!overlay || overlay.classList.contains('hidden')) return;
        overlay.classList.add('hidden');
        clearResult();
    }

    function register() {
        const menu = $('reportesMenu');
        const button = $('reportesMenuBtn');
        const panel = $('reportesMenuPanel');
        if (!menu || !button || !panel || !R) return;
        button.addEventListener('click', () => setMenuOpen(panel.classList.contains('hidden')));
        panel.addEventListener('click', (event) => {
            const item = event.target.closest('[data-reporte]');
            if (!item) return;
            setMenuOpen(false);
            open(item.dataset.reporte);
        });
        document.addEventListener('click', (event) => {
            if (!event.target.closest('#reportesMenu')) setMenuOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (!panel.classList.contains('hidden')) {
                setMenuOpen(false);
                button.focus();
            } else if (!$('reporteOverlay').classList.contains('hidden')) {
                close();
                button.focus();
            }
        });
        $('reporteFilterForm').addEventListener('submit', (event) => {
            event.preventDefault();
            void search();
        });
        // Al cambiar un filtro, la hoja ya no corresponde a lo que se ve: hay que buscar de nuevo.
        // Tambien descarta una busqueda en curso, para no mostrar el resultado de los filtros anteriores.
        $('reporteFilterForm').addEventListener('change', () => {
            const buscarBtn = $('reporteBuscarBtn');
            const hadResultOrSearch = Boolean(state.data) || buscarBtn.disabled;
            state.requestId += 1;
            clearResult();
            buscarBtn.disabled = false;
            if (hadResultOrSearch) {
                setFormMessage($('reporteMessage'), 'Cambiaste los filtros: presiona BUSCAR para actualizar el reporte.', '');
            }
        });
        $('reporteImprimirBtn').addEventListener('click', print);
        $('reporteCerrarBtn').addEventListener('click', close);
        $('reporteOverlay').addEventListener('click', (event) => {
            if (event.target === $('reporteOverlay')) close();
        });
    }

    window.SiaReportesUi = { open, close, loadBranches };
    register();
})();
