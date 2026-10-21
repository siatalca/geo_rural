// Paneles por rol: selector de rol (usuarios con 2 roles), panel del Contador, dashboard del Supervisor
// y la columna Factura (subir / descargar / imprimir PDF) del panel FACTURAS SOLICITADAS.
// Usa funciones globales de script.js: apiRequest, getApiKey, escapeHtml, normalizeUserRole, currentUser, ui, API_BASE.
(function () {
    const $ = (id) => document.getElementById(id);
    const ROLE_LABELS = { SUPER: 'Super', ADMIN: 'Administrador', SECRETARIA: 'Secretaria', OPERADOR: 'Operador', SUPERVISOR: 'Supervisor', CONTADOR: 'Contador' };
    const UPLOAD_ROLES = ['CONTADOR', 'SECRETARIA', 'SUPER'];
    const VIEW_ROLES = ['CONTADOR', 'SECRETARIA', 'ADMIN', 'SUPER'];
    const MAX_PDF_BYTES = 10 * 1024 * 1024;
    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    const activeRole = () => normalizeUserRole(currentUser?.role);
    const canUpload = () => UPLOAD_ROLES.includes(activeRole());
    const canView = () => VIEW_ROLES.includes(activeRole());
    const esc = (value) => escapeHtml(String(value ?? ''));
    const clp = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;
    const clpCorto = (n) => {
        const v = Number(n) || 0;
        if (v === 0) return '$ 0';
        return v >= 1e6 ? `$ ${(v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })} M` : `$ ${Math.round(v / 1e3).toLocaleString('es-CL')} mil`;
    };
    const fecha = (value) => {
        if (!value) return '';
        const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CL');
    };
    const fechaHora = (value) => {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
    };
    // Fecha local AAAA-MM-DD (toISOString usaría UTC y en la tarde daría el día siguiente).
    const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const show = (id, visible) => $(id)?.classList.toggle('hidden', !visible);

    // ---------- Íconos (sin texto; la ayuda la muestra button-help.js con data-help) ----------
    const ICONS = {
        subir: '<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
        descargar: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
        imprimir: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1"/><path d="M7 14h10v6H7z"/>',
        sustituir: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>'
    };
    function iconButton(accion, data, label, help, level = '') {
        const attrs = Object.entries(data)
            .map(([key, value]) => `data-${key}="${esc(value)}"`)
            .join(' ');
        return `<button type="button" class="icon-btn${level ? ' icon-btn-warn' : ''}" data-factura-accion="${accion}" ${attrs} aria-label="${esc(label)}" data-help="${esc(help)}"${level ? ` data-help-level="${level}"` : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[accion]}</svg></button>`;
    }

    // Botones de la columna Factura para una solicitud: { id, numIngreso, cliente, monto, estado, documento: { folio, fechaEmision } }
    function facturaButtons(item) {
        const data = { id: item.id, ingreso: item.numIngreso || '', cliente: item.cliente || '', monto: item.monto || 0, folio: item.documento?.folio || '' };
        if (item.documento) {
            const folio = item.documento.folio;
            return [
                `<span class="factura-folio">Folio ${esc(folio)}</span>`,
                canView() ? iconButton('descargar', data, `Descargar factura folio ${folio}`, `Descargar el PDF de la factura folio ${folio}.`) : '',
                canView() ? iconButton('imprimir', data, `Imprimir factura folio ${folio}`, `Imprimir la factura folio ${folio}.`) : '',
                canUpload() ? iconButton('sustituir', data, 'Sustituir factura', 'Reemplazar el PDF de la factura. Pide el motivo y el PDF anterior queda guardado.', 'cuidado') : ''
            ].join('');
        }
        if (canUpload() && String(item.estado || '').toUpperCase() !== 'ANULADA') {
            return iconButton('subir', data, 'Adjuntar factura', 'Adjuntar el PDF de la factura con su folio y fecha de emisión.');
        }
        return '<span class="helper-text">—</span>';
    }

    // Celda para la tabla actual de FACTURAS SOLICITADAS (items de script.js).
    function facturaCell(item) {
        return facturaButtons({
            id: item.requestId,
            numIngreso: item.numIngreso,
            cliente: item.nombreRazonSocial,
            monto: item.montoFacturar,
            estado: item.estado,
            documento: item.documento
        });
    }

    // ---------- Selector de rol ----------
    function renderRoleSwitch(user) {
        const roles = Array.isArray(user?.roles) ? user.roles : [];
        const wrap = $('roleSwitchWrap');
        const select = $('roleSwitchSelect');
        if (!wrap || !select) return;
        wrap.classList.toggle('hidden', roles.length < 2);
        select.innerHTML = roles.map((role) => `<option value="${esc(role)}">${esc(ROLE_LABELS[role] || role)}</option>`).join('');
        select.value = normalizeUserRole(user.role);

        // El SUPER usa el selector para "ver como" otros roles; mientras no esté como Super, se le avisa.
        const esSuper = roles[0] === 'SUPER';
        const label = $('roleSwitchLabel');
        if (label) label.textContent = esSuper ? 'VER COMO' : 'TRABAJANDO COMO';
        select.dataset.help = esSuper
            ? 'Ver el sistema como otro rol, con sus mismos permisos, para revisar o probar. Vuelve a Super cuando termines.'
            : 'Tienes dos roles: elige con cuál trabajar. La página se recarga con las opciones de ese rol.';
        const viendoComo = esSuper && normalizeUserRole(user.role) !== 'SUPER';
        show('superViewAsNotice', viendoComo);
        if (viendoComo) {
            $('superViewAsText').textContent = `Estás viendo el sistema como ${ROLE_LABELS[normalizeUserRole(user.role)] || user.role}, con sus mismos permisos. Lo que hagas queda registrado con tu usuario.`;
        }
    }

    async function switchRole(role) {
        try {
            await apiRequest('/auth/rol-activo', { method: 'POST', body: JSON.stringify({ role }) });
            window.location.reload();
        } catch (error) {
            alert(error.message || 'No fue posible cambiar de rol.');
            renderRoleSwitch(currentUser);
        }
    }

    // ---------- Vistas por rol ----------
    function hidePanels() {
        ['contadorPanel', 'supervisorDashboard', 'supervisorTabs'].forEach((id) => show(id, false));
    }

    function apply(user) {
        renderRoleSwitch(user);
        hidePanels();
        const role = normalizeUserRole(user?.role);
        if (role === 'CONTADOR') {
            ui.registroForm.classList.add('hidden');
            show('contadorPanel', true);
            void loadContador();
        } else if (role === 'SUPERVISOR') {
            show('supervisorTabs', true);
            showSupervisorTab('resumen');
        }
    }

    function reset() {
        hidePanels();
        show('roleSwitchWrap', false);
        show('superViewAsNotice', false);
        closeUpload();
        hideTip();
    }

    function showSupervisorTab(tab) {
        document.querySelectorAll('[data-supervisor-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.supervisorTab === tab)));
        const resumen = tab === 'resumen';
        show('supervisorDashboard', resumen);
        ui.registroForm.classList.toggle('hidden', resumen);
        hideTip();
        if (resumen) void loadSupervisor();
    }

    // ---------- Panel del Contador ----------
    async function loadContador() {
        const message = $('contadorMessage');
        try {
            const data = await apiRequest('/contador/resumen');
            renderContador(data);
            setFormMessage(message, '', '');
        } catch (error) {
            setFormMessage(message, error.message || 'No fue posible cargar el panel del contador.', 'error');
        }
    }

    function renderContador(data) {
        const r = data.resumen || {};
        const cards = [
            ['Por facturar', r.porFacturar || 0, 'solicitudes enviadas sin PDF', (r.porFacturar || 0) > 0],
            ['Monto pendiente', clpCorto(r.montoPendiente), 'de las solicitudes por facturar', false],
            ['Cargadas este mes', r.cargadasMes || 0, 'facturas con PDF', false],
            ['Facturado este mes', clpCorto(r.montoFacturadoMes), 'según monto solicitado', false],
            ['Más antigua sin facturar', r.porFacturar ? `${r.diasMasAntigua} días` : '—', 'desde el envío al contador', (r.diasMasAntigua || 0) >= 8]
        ];
        $('contadorKpis').innerHTML = kpiCards(cards);

        const pendientes = Array.isArray(data.pendientes) ? data.pendientes : [];
        const term = ($('contadorSearch')?.value || '').trim().toLowerCase();
        const filtrados = pendientes.filter((p) => !term || `${p.numIngreso} ${p.cliente} ${p.rut}`.toLowerCase().includes(term));
        $('contadorPendientesBody').innerHTML = filtrados.length
            ? filtrados
                  .map(
                      (p) => `<tr>
                        <td>${esc(p.numIngreso)}</td><td>${esc(p.cliente)}</td><td>${esc(p.rut)}</td><td class="num">${clp(p.monto)}</td>
                        <td><span class="estado-badge ${p.dias >= 8 ? 'old' : 'wait'}">hace ${p.dias} ${p.dias === 1 ? 'día' : 'días'}</span></td>
                        <td class="factura-doc-cell">${facturaButtons({ id: p.id, numIngreso: p.numIngreso, cliente: p.cliente, monto: p.monto, estado: 'ENVIADA', documento: null })}</td>
                      </tr>`
                  )
                  .join('')
            : `<tr><td colspan="6">${pendientes.length ? 'Sin resultados para la búsqueda.' : 'No hay solicitudes por facturar.'}</td></tr>`;
        contadorData = data;

        const cargadas = Array.isArray(data.cargadas) ? data.cargadas : [];
        $('contadorCargadasBody').innerHTML = cargadas.length
            ? cargadas
                  .map(
                      (c) => `<tr>
                        <td><strong>${esc(c.folio)}</strong></td><td>${fecha(c.fechaEmision)}</td><td>${esc(c.numIngreso)}</td><td>${esc(c.cliente)}</td>
                        <td class="num">${clp(c.monto)}</td><td>${esc(c.subidoPor)}</td>
                        <td class="factura-doc-cell">${facturaButtons({ id: c.solicitudId, numIngreso: c.numIngreso, cliente: c.cliente, monto: c.monto, estado: 'ENVIADA', documento: { folio: c.folio, fechaEmision: c.fechaEmision } })}</td>
                      </tr>`
                  )
                  .join('')
            : '<tr><td colspan="7">Aún no hay facturas cargadas.</td></tr>';

        const acciones = { CARGA: 'cargó', SUSTITUCION: 'sustituyó', DESCARGA: 'descargó', IMPRESION: 'imprimió' };
        const eventos = Array.isArray(data.eventos) ? data.eventos : [];
        $('contadorEventos').innerHTML = eventos.length
            ? eventos
                  .map((e) => `<li><time>${fechaHora(e.fecha)}</time>${esc(e.usuario)} (${esc(ROLE_LABELS[e.rol] || e.rol)}) ${acciones[e.accion] || esc(e.accion)} la factura del ingreso ${esc(e.numIngreso || '-')}${e.detalle ? `: ${esc(e.detalle)}` : ''}</li>`)
                  .join('')
            : '<li>Sin actividad todavía.</li>';
    }
    let contadorData = null;

    function kpiCards(cards) {
        return cards.map(([label, value, note, alert]) => `<div class="kpi-card${alert ? ' alert' : ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');
    }

    // ---------- Subir / sustituir ----------
    let editing = null;

    function openUpload(dataset, replace) {
        if (!canUpload()) {
            alert('Tu rol no puede subir facturas. Solo Contador, Secretaria y Super.');
            return;
        }
        editing = { id: dataset.id, replace };
        $('facturaUploadTitle').textContent = replace ? 'SUSTITUIR FACTURA' : 'ADJUNTAR FACTURA';
        $('facturaUploadSubtitle').textContent = `Ingreso ${dataset.ingreso || '-'} · ${dataset.cliente || ''} · ${clp(dataset.monto)}`;
        $('facturaUploadForm').reset();
        $('facturaUploadFecha').value = isoLocal(new Date());
        $('facturaUploadFecha').max = isoLocal(new Date());
        $('facturaUploadFolio').value = replace ? dataset.folio || '' : '';
        show('facturaUploadMotivoGroup', replace);
        setFormMessage($('facturaUploadMessage'), '', '');
        show('facturaUploadOverlay', true);
        $('facturaUploadFile').focus();
    }

    function closeUpload() {
        editing = null;
        show('facturaUploadOverlay', false);
    }

    // Mismo control que el servidor: %PDF- al inicio y %%EOF al final.
    async function isRealPdf(file) {
        const head = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
        const tail = new TextDecoder().decode(await file.slice(Math.max(0, file.size - 2048)).arrayBuffer());
        return head === '%PDF-' && tail.includes('%%EOF');
    }

    async function submitUpload(event) {
        event.preventDefault();
        if (!editing) return;
        const message = $('facturaUploadMessage');
        const file = $('facturaUploadFile').files[0];
        const folio = $('facturaUploadFolio').value.trim();
        const fechaValue = $('facturaUploadFecha').value;
        const motivo = $('facturaUploadMotivo').value.trim();
        const fail = (text) => setFormMessage(message, text, 'error');
        if (!file) return fail('Selecciona el PDF de la factura.');
        if (file.size > MAX_PDF_BYTES) return fail('El archivo supera los 10 MB.');
        if (!(await isRealPdf(file))) return fail('El archivo no es un PDF válido. No se guardó nada.');
        if (!/^[0-9]{1,20}$/.test(folio)) return fail('El folio debe tener solo números.');
        if (!fechaValue) return fail('Indica la fecha de emisión.');
        if (fechaValue > isoLocal(new Date())) return fail('La fecha de emisión no puede ser futura.');
        if (editing.replace && motivo.length < 5) return fail('Explica brevemente el motivo de la sustitución.');

        const button = $('facturaUploadSubmit');
        button.disabled = true;
        setFormMessage(message, 'Guardando factura...', 'success');
        try {
            const result = await apiRequest(`/facturas/solicitudes/${encodeURIComponent(editing.id)}/documento${editing.replace ? '?reemplazar=1' : ''}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/pdf',
                    'X-Factura-Folio': folio,
                    'X-Factura-Fecha': fechaValue,
                    'X-Factura-Motivo': encodeURIComponent(motivo)
                },
                body: file
            });
            closeUpload();
            await refreshAfterChange(result.message || 'Factura guardada.');
        } catch (error) {
            fail(error.message || 'No fue posible guardar la factura.');
        } finally {
            button.disabled = false;
        }
    }

    async function refreshAfterChange(text) {
        if (!$('contadorPanel')?.classList.contains('hidden')) {
            await loadContador();
            setFormMessage($('contadorMessage'), text, 'success');
        }
        if (typeof refreshRequestedInvoicesHistory === 'function' && !ui?.secretariaInvoicesModalOverlay?.classList.contains('hidden')) {
            await refreshRequestedInvoicesHistory({ showErrors: false });
            if (typeof renderRequestedInvoicesHistory === 'function') renderRequestedInvoicesHistory();
            setFormMessage(ui.secretariaInvoicesMessage, text, 'success');
        }
    }

    // ---------- Descargar / imprimir ----------
    async function fetchPdf(id, modo) {
        const headers = {};
        const apiKey = typeof getApiKey === 'function' ? getApiKey() : '';
        if (apiKey) headers['X-API-Key'] = apiKey;
        const response = await fetch(`${API_BASE}/facturas/solicitudes/${encodeURIComponent(id)}/documento?modo=${modo}`, { credentials: 'include', headers });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.message || 'No fue posible obtener la factura.');
        }
        return response.blob();
    }

    async function openPdf(dataset, print) {
        try {
            const blob = await fetchPdf(dataset.id, print ? 'imprimir' : 'descargar');
            const url = URL.createObjectURL(blob);
            if (!print) {
                const link = document.createElement('a');
                link.href = url;
                link.download = `Factura_${dataset.folio || dataset.id}_${dataset.ingreso || ''}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
                return;
            }
            // Imprime desde un marco oculto, igual que la solicitud de ingreso.
            const frame = document.createElement('iframe');
            frame.setAttribute('aria-hidden', 'true');
            frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
            frame.onload = () => {
                frame.contentWindow.focus();
                frame.contentWindow.print();
                setTimeout(() => {
                    frame.remove();
                    URL.revokeObjectURL(url);
                }, 60000);
            };
            frame.src = url;
            document.body.appendChild(frame);
        } catch (error) {
            const target = !$('contadorPanel')?.classList.contains('hidden') ? $('contadorMessage') : ui?.secretariaInvoicesMessage;
            if (target) setFormMessage(target, error.message, 'error');
            else alert(error.message);
        }
    }

    // ---------- Dashboard del Supervisor ----------
    const NS = 'http://www.w3.org/2000/svg';
    const tip = () => $('vizTooltip');
    function showTip(event, html) {
        const box = tip();
        if (!box) return;
        box.innerHTML = html;
        box.hidden = false;
        const rect = box.getBoundingClientRect();
        let x = event.clientX + 14;
        let y = event.clientY - rect.height - 10;
        if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - 14;
        if (y < 8) y = event.clientY + 16;
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
    }
    function hideTip() {
        if (tip()) tip().hidden = true;
    }
    function el(name, attrs, parent) {
        const node = document.createElementNS(NS, name);
        Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
        if (parent) parent.appendChild(node);
        return node;
    }
    function svgFor(container, width, height, label) {
        container.innerHTML = '';
        return el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label, class: 'viz-svg' }, container);
    }
    // Barra con el extremo de datos redondeado (4px) y la base recta sobre el eje.
    function barPath(x, y, w, h, horizontal) {
        if (h <= 0 || w <= 0) return '';
        const r = Math.min(4, horizontal ? h / 2 : w / 2, horizontal ? w : h);
        return horizontal
            ? `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`
            : `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    }
    // Máximo del eje con 4 tramos redondos (1, 2, 5 × potencia de 10).
    function niceMax(v) {
        if (v <= 0) return 4;
        const raw = v / 4;
        const p = 10 ** Math.floor(Math.log10(raw));
        return [1, 2, 5, 10].map((s) => s * p).find((s) => s >= raw) * 4;
    }
    function bindHover(target, html) {
        target.addEventListener('pointermove', (event) => showTip(event, html));
        target.addEventListener('pointerleave', hideTip);
        target.setAttribute('tabindex', '0');
        target.addEventListener('focus', () => {
            const r = target.getBoundingClientRect();
            showTip({ clientX: r.left + r.width / 2, clientY: r.top }, html);
        });
        target.addEventListener('blur', hideTip);
    }
    function emptyChart(container, text) {
        container.innerHTML = `<p class="helper-text viz-empty">${esc(text)}</p>`;
    }

    function stackedColumns(container, rows) {
        if (!rows.some((r) => r.facturado + r.pendiente > 0)) return emptyChart(container, 'Aún no hay montos a facturar registrados en el período.');
        const W = 760, H = 230, L = 58, R = 10, T = 16, B = 30;
        const svg = svgFor(container, W, H, 'Montos facturados y pendientes por mes');
        const max = niceMax(Math.max(...rows.map((r) => r.facturado + r.pendiente)));
        const y = (v) => T + (H - T - B) * (1 - v / max);
        for (let i = 0; i <= 4; i += 1) {
            const v = (max / 4) * i;
            el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: i === 0 ? 'viz-axis' : 'viz-gridline' }, svg);
            el('text', { x: L - 8, y: y(v) + 4, class: 'viz-tick', 'text-anchor': 'end' }, svg).textContent = clpCorto(v);
        }
        const band = (W - L - R) / rows.length;
        const bw = Math.min(30, band * 0.56);
        rows.forEach((r, i) => {
            const x = L + band * i + (band - bw) / 2;
            const yF = y(r.facturado);
            el('path', { d: barPath(x, yF, bw, y(0) - yF, false), class: 'viz-s1' }, svg);
            if (r.pendiente > 0) {
                const yP = y(r.facturado + r.pendiente);
                el('path', { d: barPath(x, yP, bw, Math.max(0, yF - 2 - yP), false), class: 'viz-s2' }, svg);
            }
            el('text', { x: x + bw / 2, y: H - 10, class: 'viz-tick', 'text-anchor': 'middle' }, svg).textContent = r.label;
            const hit = el('rect', { x: L + band * i, y: T, width: band, height: H - T - B, class: 'viz-hit' }, svg);
            bindHover(hit, `<strong>${esc(r.label)}</strong><br><span class="sw viz-s1"></span>Facturado: ${clp(r.facturado)}<br><span class="sw viz-s2"></span>Pendiente: ${clp(r.pendiente)}<br>Total: ${clp(r.facturado + r.pendiente)}`);
        });
    }

    function columns(container, rows, label) {
        const W = 380, H = 230, L = 30, R = 8, T = 18, B = 30;
        const svg = svgFor(container, W, H, label);
        const max = niceMax(Math.max(...rows.map((r) => r.value), 0));
        const y = (v) => T + (H - T - B) * (1 - v / max);
        for (let i = 0; i <= 4; i += 1) {
            const v = (max / 4) * i;
            el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: i === 0 ? 'viz-axis' : 'viz-gridline' }, svg);
            el('text', { x: L - 6, y: y(v) + 4, class: 'viz-tick', 'text-anchor': 'end' }, svg).textContent = Math.round(v);
        }
        const band = (W - L - R) / rows.length;
        const bw = Math.min(18, band * 0.6);
        const maxIndex = rows.reduce((best, r, i) => (r.value > rows[best].value ? i : best), 0);
        rows.forEach((r, i) => {
            const x = L + band * i + (band - bw) / 2;
            el('path', { d: barPath(x, y(r.value), bw, y(0) - y(r.value), false), class: 'viz-s1' }, svg);
            if ((i === rows.length - 1 || i === maxIndex) && r.value > 0) {
                el('text', { x: x + bw / 2, y: y(r.value) - 5, class: 'viz-value', 'text-anchor': 'middle' }, svg).textContent = r.value;
            }
            if (rows.length <= 6 || i % 2 === rows.length % 2) {
                el('text', { x: x + bw / 2, y: H - 10, class: 'viz-tick', 'text-anchor': 'middle' }, svg).textContent = r.label;
            }
            const hit = el('rect', { x: L + band * i, y: T, width: band, height: H - T - B, class: 'viz-hit' }, svg);
            bindHover(hit, `<strong>${esc(r.label)}</strong><br>${r.value} carpetas ingresadas`);
        });
    }

    function hbars(container, rows, { format, tooltip, label, empty }) {
        if (!rows.length || !rows.some((r) => r.value > 0)) return emptyChart(container, empty);
        const W = 380, rowH = 30, L = 150, R = 76, T = 6;
        const H = T * 2 + rows.length * rowH;
        const svg = svgFor(container, W, H, label);
        const max = Math.max(...rows.map((r) => r.value), 1);
        rows.forEach((r, i) => {
            const yTop = T + i * rowH;
            const w = ((W - L - R) * r.value) / max;
            el('text', { x: L - 8, y: yTop + rowH / 2 + 4, class: 'viz-label', 'text-anchor': 'end' }, svg).textContent = r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label;
            el('path', { d: barPath(L, yTop + 7, Math.max(w, 2), rowH - 14, true), class: 'viz-s1' }, svg);
            el('text', { x: L + w + 6, y: yTop + rowH / 2 + 4, class: 'viz-value' }, svg).textContent = format(r.value);
            const hit = el('rect', { x: 0, y: yTop, width: W, height: rowH, class: 'viz-hit' }, svg);
            bindHover(hit, tooltip(r));
        });
        el('line', { x1: L, x2: L, y1: T, y2: H - T, class: 'viz-axis' }, svg);
    }

    let sucursalesCargadas = false;
    async function loadSupervisor() {
        const message = $('supervisorMessage');
        try {
            const query = new URLSearchParams({ meses: $('supervisorPeriodo').value, sucursal: $('supervisorSucursal').value });
            const data = await apiRequest(`/supervisor/resumen?${query}`);
            if (!sucursalesCargadas) {
                $('supervisorSucursal').innerHTML = `<option value="">Todas</option>${(data.sucursales || []).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
                sucursalesCargadas = true;
            }
            renderSupervisor(data);
            setFormMessage(message, '', '');
        } catch (error) {
            setFormMessage(message, error.message || 'No fue posible cargar el resumen.', 'error');
        }
    }

    function renderSupervisor(data) {
        const k = data.kpis || {};
        const variacion = k.ingresosMesAnterior ? Math.round(((k.ingresosMes - k.ingresosMesAnterior) / k.ingresosMesAnterior) * 100) : 0;
        const conMonto = (k.carpetasFacturadas || 0) + (k.carpetasPendientes || 0);
        $('supervisorKpis').innerHTML = kpiCards([
            ['Carpetas activas', (k.activas || 0).toLocaleString('es-CL'), `${k.cerradasPeriodo || 0} cerradas en el período`, false],
            ['Ingresos este mes', k.ingresosMes || 0, k.ingresosMesAnterior ? `${variacion >= 0 ? '▲' : '▼'} ${Math.abs(variacion)} % vs mes anterior` : 'sin datos del mes anterior', false],
            ['Sin movimiento 8+ días', k.sinMovimiento || 0, 'requieren seguimiento', (k.sinMovimiento || 0) > 0],
            ['Facturado en el período', clpCorto(k.facturado), `${k.carpetasFacturadas || 0} carpetas`, false],
            ['Pendiente de facturar', clpCorto(k.pendiente), `${k.carpetasPendientes || 0} carpetas con monto`, (k.pendiente || 0) > 0],
            ['Monto promedio por carpeta', clpCorto(conMonto ? ((k.facturado || 0) + (k.pendiente || 0)) / conMonto : 0), 'con monto a facturar', false]
        ]);

        const porMes = (data.porMes || []).map((m) => ({ label: `${MESES[m.mes - 1]} ${String(m.anio).slice(2)}`, value: m.ingresos, facturado: m.facturado, pendiente: m.pendiente }));
        const totalF = porMes.reduce((t, m) => t + m.facturado, 0);
        const totalP = porMes.reduce((t, m) => t + m.pendiente, 0);
        $('supervisorLegendMontos').innerHTML = `<span><i class="sw viz-s1"></i>Facturado ${clpCorto(totalF)}</span><span><i class="sw viz-s2"></i>Pendiente ${clpCorto(totalP)}</span>`;
        stackedColumns($('supervisorChartMontos'), porMes);
        columns($('supervisorChartIngresos'), porMes, 'Carpetas ingresadas por mes');

        const etapas = (data.etapas || []).map((e) => ({ label: e.label, value: e.cantidad }));
        $('supervisorNotaEtapas').textContent = `${k.activas || 0} carpetas activas según su estado actual`;
        hbars($('supervisorChartEtapas'), etapas, {
            label: 'Carpetas activas por etapa',
            empty: 'No hay carpetas activas.',
            format: (v) => `${v}`,
            tooltip: (r) => `<strong>${esc(r.label)}</strong><br>${r.value} carpetas (${Math.round((r.value / Math.max(k.activas || 0, 1)) * 100)} % de las activas)`
        });
        const clientes = data.clientes || [];
        const porMonto = clientes.some((c) => c.monto > 0);
        $('supervisorNotaClientes').textContent = porMonto ? 'Monto a facturar en el período' : 'Carpetas en el período';
        hbars($('supervisorChartClientes'), clientes.map((c) => ({ ...c, value: porMonto ? c.monto : c.carpetas })), {
            label: 'Clientes principales',
            empty: 'Sin carpetas en el período.',
            format: porMonto ? clpCorto : (v) => `${v}`,
            tooltip: (r) => `<strong>${esc(r.label)}</strong><br>${r.carpetas} carpetas · ${clp(r.monto)}<br>Pendiente de facturar: ${clp(r.pendiente)}`
        });
        hbars($('supervisorChartComunas'), (data.comunas || []).map((c) => ({ ...c, value: c.carpetas })), {
            label: 'Ingresos por comuna',
            empty: 'Sin carpetas en el período.',
            format: (v) => `${v}`,
            tooltip: (r) => `<strong>${esc(r.label)}</strong><br>${r.carpetas} carpetas (${Math.round((r.carpetas / Math.max(k.carpetasPeriodo || 0, 1)) * 100)} % del período)`
        });

        // Aviso de carpetas sin monto a facturar (no suman en los gráficos de montos).
        const sinMonto = data.sinMonto || { total: 0, carpetas: [] };
        show('supervisorAvisoMonto', sinMonto.total > 0);
        if (sinMonto.total > 0) {
            $('supervisorAvisoMontoTexto').textContent = `${sinMonto.total} ${sinMonto.total === 1 ? 'carpeta del período no tiene' : 'carpetas del período no tienen'} monto a facturar. Ver cuáles`;
            $('supervisorAvisoMontoLista').innerHTML =
                sinMonto.carpetas.map((c) => `<li><strong>${esc(c.numIngreso)}</strong> · ${esc(c.cliente)} · ingresada ${fecha(c.fecha)}</li>`).join('') +
                (sinMonto.total > sinMonto.carpetas.length ? `<li>y ${sinMonto.total - sinMonto.carpetas.length} más.</li>` : '');
        }

        const atencion = data.atencion || [];
        $('supervisorAtencionBody').innerHTML = atencion.length
            ? atencion
                  .map((a) => `<tr><td>${esc(a.numIngreso)}</td><td>${esc(a.cliente)}</td><td><span class="estado-badge">${esc(a.etapa)}</span></td><td>${esc(a.comuna)}</td><td class="num">${clp(a.monto)}</td><td class="num"><span class="estado-badge ${a.dias >= 15 ? 'old' : 'wait'}">${a.dias} días</span></td></tr>`)
                  .join('')
            : '<tr><td colspan="6">Todas las carpetas activas tienen movimiento reciente.</td></tr>';
    }

    // ---------- Eventos ----------
    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-factura-accion]');
        if (button) {
            event.stopPropagation();
            const accion = button.dataset.facturaAccion;
            if (accion === 'subir') openUpload(button.dataset, false);
            else if (accion === 'sustituir') openUpload(button.dataset, true);
            else void openPdf(button.dataset, accion === 'imprimir');
            return;
        }
        const tab = event.target.closest('[data-supervisor-tab]');
        if (tab) showSupervisorTab(tab.dataset.supervisorTab);
    }, true);

    document.addEventListener('DOMContentLoaded', () => {
        $('roleSwitchSelect')?.addEventListener('change', (event) => void switchRole(event.target.value));
        $('superViewAsBack')?.addEventListener('click', () => void switchRole('SUPER'));
        $('facturaUploadForm')?.addEventListener('submit', (event) => void submitUpload(event));
        $('facturaUploadCancel')?.addEventListener('click', closeUpload);
        $('contadorSearch')?.addEventListener('input', () => contadorData && renderContador(contadorData));
        $('contadorRefresh')?.addEventListener('click', () => void loadContador());
        $('supervisorPeriodo')?.addEventListener('change', () => void loadSupervisor());
        $('supervisorSucursal')?.addEventListener('change', () => void loadSupervisor());
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && editing) closeUpload();
        });
        window.addEventListener('scroll', hideTip, true);
    });

    window.SiaRolePanels = { apply, reset, facturaCell };
})();
