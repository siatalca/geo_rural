// Ayuda breve al dejar el cursor (o el foco del teclado) sobre un botón.
// Nivel: '' normal, 'cuidado' cambia datos o envía correos, 'peligro' borra o no se puede deshacer.
(function () {
    const HELP_BY_ID = {
        // Sesión e inicio
        logoutBtn: ['Cierra tu sesión en este equipo.', 'cuidado'],
        onboardingCompleteBtn: ['Marca la guía como leída y entra al sistema.', ''],
        onboardingLogoutBtn: ['Sale sin terminar la guía; la verás de nuevo al ingresar.', ''],

        // Menú de administración
        adminToggleUsersBtn: ['Abre la lista de usuarios para crearlos, editarlos o restablecer su clave.', ''],
        adminToggleBranchesBtn: ['Abre la lista de sucursales para agregarlas o cambiarlas.', ''],
        adminToggleDocumentsBtn: ['Abre los estados de carpeta y sus categorías.', ''],
        adminToggleEmailBtn: ['Configura la cuenta de correo (SMTP) desde la que se envían cotizaciones y facturas.', ''],
        adminToggleMailTemplatesBtn: ['Edita el texto de los correos de cotización y factura.', ''],
        adminToggleUsageBtn: ['Muestra las sesiones abiertas y desde qué equipos.', ''],
        adminToggleMaintenanceBtn: ['Opciones para poner el sitio en mantención y avisos de acceso.', ''],
        secretariaViewInvoicesBtn: ['Lista las solicitudes de factura recibidas.', ''],
        secretariaQuotationBtn: ['Prepara y envía una cotización por correo al cliente.', ''],
        secretariaEditUtmBtn: ['Cambia el valor de la UTM del mes usado en cotizaciones.', 'cuidado'],
        secretariaNoMovementBtn: ['Muestra los registros sin movimiento hace 8 días o más.', ''],
        adminYearCurrentBtn: ['Trabaja con ingresos del año en curso; el N° de ingreso se asigna solo.', ''],
        adminYearPastBtn: ['Permite ingresar registros de años anteriores escribiendo el N° de ingreso.', ''],

        // Usuarios, sucursales y estados
        adminCreateUserBtn: ['Crea el usuario o guarda los cambios del que estás editando.', 'cuidado'],
        adminCancelEditBtn: ['Deja de editar el usuario sin guardar cambios.', ''],
        adminBranchSaveBtn: ['Agrega la sucursal o guarda el nombre que estás editando.', 'cuidado'],
        adminBranchCancelBtn: ['Deja de editar la sucursal sin guardar cambios.', ''],
        adminDocumentSaveBtn: ['Agrega el estado de carpeta o guarda el que estás editando.', 'cuidado'],
        adminDocumentCancelBtn: ['Deja de editar el estado sin guardar cambios.', ''],
        adminDocumentGroupSaveBtn: ['Guarda los nombres de las categorías de estados.', 'cuidado'],

        // Correo y plantillas
        adminEmailLoadBtn: ['Vuelve a cargar la configuración guardada; descarta lo que no hayas guardado.', 'cuidado'],
        adminEmailSaveBtn: ['Guarda la configuración del correo.', 'cuidado'],
        adminEmailTestBtn: ['Envía un correo corto de prueba con la configuración guardada.', ''],
        adminMailTemplatePreviewBtn: ['Muestra cómo se verá el correo con datos de ejemplo.', ''],
        adminMailTemplateReloadBtn: ['Descarta los cambios no guardados y recarga las plantillas.', 'cuidado'],
        adminMailTemplateSaveBtn: ['Guarda las plantillas; los próximos correos usarán este texto.', 'cuidado'],
        adminMailTemplatePendingLessBtn: ['Muestra menos facturas de ejemplo en la vista previa.', ''],
        adminMailTemplatePendingMoreBtn: ['Muestra más facturas de ejemplo en la vista previa.', ''],
        adminUsageRefreshBtn: ['Actualiza la lista de equipos conectados.', ''],

        // Mantención y aviso de acceso
        adminMaintenanceEnableBtn: ['Bloquea el sitio para todos menos el super y muestra la página de mantención.', 'peligro'],
        adminMaintenanceDisableBtn: ['Vuelve a abrir el sitio para todos los usuarios.', 'cuidado'],
        adminMaintenanceRefreshBtn: ['Consulta si el sitio está en mantención.', ''],
        adminLoginNoticeEnableBtn: ['Muestra durante 15 días un aviso con la nueva dirección de acceso.', 'cuidado'],
        adminLoginNoticeDisableBtn: ['Quita el aviso de cambio de dirección de acceso.', 'cuidado'],
        adminLoginNoticeRefreshBtn: ['Guarda la dirección que mostrará el aviso.', 'cuidado'],
        enableMaintenanceBtn: ['Bloquea el sitio para todos menos el super y muestra la página de mantención.', 'peligro'],
        disableMaintenanceBtn: ['Vuelve a abrir el sitio para todos los usuarios.', 'cuidado'],
        refreshMaintenanceBtn: ['Consulta si el sitio está en mantención.', ''],
        superLogoutBtn: ['Cierra la sesión del super en este equipo.', 'cuidado'],

        // Formulario de ingreso
        buscarFechaBtn: ['Busca registros ingresados entre dos fechas.', ''],
        operatorDocAlertsBtn: ['Busca carpetas con documentos nuevos o pendientes de revisar.', ''],
        guardarComentarioBtn: ['Agrega el comentario al historial del registro cargado.', 'cuidado'],
        imprimirSolicitudBtn: ['Imprime la solicitud de ingreso en hoja oficio para que la firme el cliente.', ''],
        facturaEnviarContadorBtn: ['Envía por correo al contador la solicitud de factura de este ingreso.', 'cuidado'],
        facturaAgregarListaBtn: ['Agrega esta factura a la lista pendiente para enviarlas juntas.', ''],
        facturaEnviarPendientesBtn: ['Envía al contador, en un solo correo, todas las facturas de la lista.', 'cuidado'],
        invoiceModalSubmitBtn: ['Guarda los datos de factura de esta ventana.', 'cuidado'],

        // Facturas solicitadas
        secretariaInvoicesClearFiltersBtn: ['Quita los filtros y muestra todas las solicitudes.', ''],
        secretariaInvoicesFirstPageBtn: ['Primera página.', ''],
        secretariaInvoicesPrevPageBtn: ['Página anterior.', ''],
        secretariaInvoicesNextPageBtn: ['Página siguiente.', ''],
        secretariaInvoicesLastPageBtn: ['Última página.', ''],
        secretariaInvoicesDetailBtn: ['Abre el detalle de la solicitud seleccionada.', ''],
        secretariaInvoiceDetailSaveBtn: ['Guarda los cambios de esta solicitud de factura.', 'cuidado'],
        secretariaInvoiceDetailResendBtn: ['Vuelve a enviar por correo esta solicitud de factura.', 'cuidado'],

        // Cotización
        secretariaQuotationRefreshBtn: ['Recalcula los valores con la UTM del mes.', ''],
        secretariaQuotationReplaceTemplateBtn: ['Reemplaza el PDF base de la carta de cotización.', 'peligro'],
        secretariaQuotationSendBtn: ['Envía la cotización al correo del cliente con el PDF adjunto.', 'cuidado'],
        mailSendProgressConfirmBtn: ['Cierra el aviso de envío.', ''],
        invoiceEmailPromptSendBtn: ['Envía el correo a la dirección indicada.', 'cuidado'],

        // Historial
        historyEditDeleteBtn: ['Elimina este comentario del historial. No se puede deshacer.', 'peligro'],
        historyEditSaveBtn: ['Guarda el comentario corregido.', 'cuidado'],

        // Búsquedas y listas
        secretaryNoMovementApplyBtn: ['Aplica los filtros a la lista.', ''],
        secretaryNoMovementCloseBtn: ['Cierra el aviso de registros sin movimiento.', ''],
        operatorDocAlertsRefreshBtn: ['Busca carpetas según los filtros elegidos.', ''],
        operatorDocAlertsExportBtn: ['Descarga la lista en Excel.', ''],
        dateRangeSearchBtn: ['Busca los registros ingresados entre las fechas elegidas.', ''],
        dateRangeExportBtn: ['Descarga en Excel los registros encontrados.', ''],
        dateRangeAcceptBtn: ['Carga en el formulario el registro seleccionado.', ''],
        dateRangeFirstBtn: ['Primera página.', ''],
        dateRangePrevBtn: ['Página anterior.', ''],
        dateRangeNextBtn: ['Página siguiente.', ''],
        dateRangeLastBtn: ['Última página.', ''],
        searchMatchAcceptBtn: ['Carga en el formulario la coincidencia seleccionada.', ''],
        searchMatchFirstBtn: ['Primera coincidencia.', ''],
        searchMatchPrevBtn: ['Coincidencia anterior.', ''],
        searchMatchNextBtn: ['Coincidencia siguiente.', ''],
        searchMatchLastBtn: ['Última coincidencia.', ''],

        // Páginas públicas
        publicProgressSearchBtn: ['Muestra el avance del trámite con el ROL ingresado.', ''],
        publicProgressClearBtn: ['Borra la búsqueda.', ''],
        loginRouteNoticeOpenBtn: ['Abre la página de ingreso del personal.', ''],
        loginRouteNoticeCloseBtn: ['Cierra este aviso.', '']
    };

    // Botones sin id o creados en tablas: se reconocen por su lugar y su texto.
    const RULES = [
        ['#registroActionsRow .guardar', 'Guarda el ingreso nuevo. Si el registro ya existe, usa MODIFICAR.', 'cuidado'],
        ['#registroActionsRow .modificar', 'Guarda los cambios del registro cargado; quedan en el historial.', 'cuidado'],
        ['#registroActionsRow .buscar:not([id])', 'Busca registros con los datos escritos (N° de ingreso, nombre, RUT o ROL).', ''],
        ['#registroActionsRow .eliminar', 'Elimina definitivamente el registro cargado y su historial. No se puede deshacer.', 'peligro'],
        ['#registroActionsRow .limpiar', 'Vacía el formulario para empezar otro ingreso. No borra nada guardado.', ''],
        ['[data-side-tab="solicitudDataSection"]', 'Datos para la solicitud de ingreso que firma el cliente.', ''],
        ['[data-side-tab="facturaDataSection"]', 'Datos para pedir la factura al contador.', ''],
        ['#adminBranchesBody .admin-edit-btn', 'Carga esta sucursal arriba para cambiar su nombre.', ''],
        ['#adminBranchesBody .admin-delete-btn', 'Elimina esta sucursal.', 'peligro'],
        ['#adminDocumentsBody .admin-edit-btn', 'Carga este estado para cambiar su nombre o categoría.', ''],
        ['#adminDocumentsBody .admin-delete-btn', 'Elimina este estado de carpeta.', 'peligro'],
        ['#adminUsersBody .admin-edit-btn', 'Carga este usuario para cambiar sus datos o su rol.', ''],
        ['#adminUsersBody .admin-reset-btn', 'Genera una clave temporal; el usuario deberá cambiarla al ingresar.', 'cuidado'],
        ['#adminUsersBody .admin-delete-btn', 'Elimina este usuario; ya no podrá ingresar.', 'peligro'],
        ['#historialBody .admin-reset-btn', 'Corrige o elimina este comentario del historial.', ''],
        ['#operatorDocAlertsBody .admin-edit-btn', 'Carga esta carpeta en el formulario.', '']
    ];

    // Último recurso: por el texto del botón (ventanas y avisos).
    const BY_TEXT = {
        INGRESAR: ['Entra al sistema con tu usuario y clave.', ''],
        'INGRESAR COMO SUPER': ['Entra con la cuenta super para administrar la mantención.', ''],
        'ACTUALIZAR CLAVE': ['Guarda tu nueva clave y continúa.', 'cuidado'],
        'GUARDAR Y CONTINUAR': ['Guarda el valor de la UTM del mes y continúa.', 'cuidado'],
        ACEPTAR: ['Confirma y cierra este aviso.', ''],
        CONFIRMAR: ['Confirma la acción.', 'cuidado'],
        ENTENDIDO: ['Cierra este aviso.', ''],
        CANCELAR: ['Cierra esta ventana sin aplicar cambios.', ''],
        CERRAR: ['Cierra esta ventana.', ''],
        LIMPIAR: ['Borra los filtros o datos escritos en esta ventana.', ''],
        'LIMPIAR FILTROS': ['Quita los filtros y muestra todo.', ''],
        BUSCAR: ['Busca con los filtros elegidos.', ''],
        GUARDAR: ['Guarda los datos de esta ventana.', 'cuidado'],
        'GUARDAR CAMBIOS': ['Guarda los cambios.', 'cuidado'],
        ELIMINAR: ['Elimina este elemento. No se puede deshacer.', 'peligro'],
        EDITAR: ['Carga este elemento para modificarlo.', '']
    };

    const LEVEL_LABEL = { cuidado: 'Cuidado: ', peligro: 'Peligro: ' };

    function resolveHelp(element) {
        if (element.dataset.help) {
            return [element.dataset.help, element.dataset.helpLevel || ''];
        }
        if (element.id && HELP_BY_ID[element.id]) {
            return HELP_BY_ID[element.id];
        }
        const rule = RULES.find(([selector]) => element.matches(selector));
        if (rule) {
            return [rule[1], rule[2]];
        }
        const text = String(element.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
        return BY_TEXT[text] || null;
    }

    let tip = null;
    let current = null;
    let timer = 0;

    function ensureTip() {
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'buttonHelpTip';
            tip.className = 'button-help-tip';
            tip.setAttribute('role', 'tooltip');
            tip.hidden = true;
            document.body.appendChild(tip);
        }
        return tip;
    }

    function show(element) {
        const help = resolveHelp(element);
        if (!help || !element.isConnected) {
            return;
        }
        const [text, level] = help;
        const box = ensureTip();
        box.textContent = '';
        if (LEVEL_LABEL[level]) {
            const label = document.createElement('strong');
            label.textContent = LEVEL_LABEL[level];
            box.appendChild(label);
        }
        box.appendChild(document.createTextNode(text));
        box.dataset.level = level || 'info';
        box.hidden = false;

        // Debajo del botón; si no cabe, encima. Nunca fuera de la pantalla.
        const rect = element.getBoundingClientRect();
        const tipRect = box.getBoundingClientRect();
        const margin = 8;
        let top = rect.bottom + margin;
        if (top + tipRect.height > window.innerHeight - margin) {
            top = Math.max(margin, rect.top - tipRect.height - margin);
        }
        const left = Math.min(Math.max(margin, rect.left + rect.width / 2 - tipRect.width / 2), window.innerWidth - tipRect.width - margin);
        box.style.top = `${Math.round(top)}px`;
        box.style.left = `${Math.round(left)}px`;
        element.setAttribute('aria-describedby', box.id);
        current = element;
    }

    function hide() {
        window.clearTimeout(timer);
        if (current) {
            current.removeAttribute('aria-describedby');
        }
        current = null;
        if (tip) {
            tip.hidden = true;
        }
    }

    function targetOf(event) {
        const element = event.target instanceof Element ? event.target.closest('button, a[class*="btn"]') : null;
        return element && resolveHelp(element) ? element : null;
    }

    function schedule(element, delay) {
        window.clearTimeout(timer);
        hide();
        timer = window.setTimeout(() => show(element), delay);
    }

    document.addEventListener('mouseover', (event) => {
        const element = targetOf(event);
        if (element && element !== current) {
            schedule(element, 500);
        }
    });
    document.addEventListener('mouseout', (event) => {
        const element = targetOf(event);
        if (element && !element.contains(event.relatedTarget)) {
            hide();
        }
    });
    document.addEventListener('focusin', (event) => {
        const element = targetOf(event);
        if (element && element.matches(':focus-visible')) {
            schedule(element, 300);
        }
    });
    document.addEventListener('focusout', hide);
    document.addEventListener('click', hide, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hide();
        }
    });
})();
