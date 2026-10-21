(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SiaRoleGuide = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const guides = {
        SUPER: {
            label: 'Superadministrador',
            intro: 'Tienes acceso a la operación y a la configuración general. Empieza por preparar el sistema para tu empresa.',
            steps: [
                ['Prepara tu empresa', 'En GESTIONAR SUCURSALES crea las sedes que usarán el sistema. En GESTIONAR USUARIOS agrega a tu equipo y asigna el rol y la sucursal correspondientes. Solo SUPER puede crear administradores.'],
                ['Configura los documentos y el correo', 'Configura el remitente y SMTP en el menú de correo. Revisa las plantillas y el PDF de cotizaciones: sustituye nombres, firmas y datos comerciales por los de tu empresa antes de enviarlos.'],
                ['Organiza la operación', 'Confirma la UTM del mes si el sistema la solicita. Puedes registrar clientes, consultar y actualizar carpetas, revisar comentarios y gestionar las solicitudes de factura.'],
                ['Controla los accesos', 'Cada persona debe tener su propia cuenta. Cuando restablezcas una contraseña, entrega la clave temporal al usuario: deberá cambiarla y verá nuevamente esta guía.']
            ]
        },
        ADMIN: {
            label: 'Administrador',
            intro: 'Tu menú reúne la administración de registros, usuarios y sucursales.',
            steps: [
                ['Organiza el equipo', 'Usa GESTIONAR USUARIOS para crear y mantener las cuentas permitidas. Asigna la sucursal correcta. La creación de otros administradores corresponde al superadministrador.'],
                ['Adapta los catálogos', 'Gestiona sucursales y los estados de carpeta desde las opciones disponibles. Usa los nombres y categorías que correspondan a la empresa.'],
                ['Registra y busca carpetas', 'Completa los datos del propietario y del predio. Antes de guardar revisa RUT, ROL y sucursal. Puedes consultar registros del año actual o históricos.'],
                ['Mantén el seguimiento', 'Actualiza los datos y comentarios de cada carpeta. Consulta el historial para conocer los cambios. Las configuraciones de correo y plantillas generales corresponden al superadministrador.']
            ]
        },
        SECRETARIA: {
            label: 'Secretaría',
            intro: 'Tu trabajo se centra en el ingreso de registros, el seguimiento administrativo y la preparación de documentos.',
            steps: [
                ['Confirma la UTM', 'Si se solicita al ingresar, revisa y confirma la UTM del mes antes de preparar cotizaciones. El valor sugerido es editable.'],
                ['Ingresa los antecedentes', 'Registra propietario, RUT, contacto, predio y ROL. Puedes trabajar con el año actual y consultar registros históricos desde tu menú.'],
                ['Revisa el seguimiento', 'Busca carpetas, actualiza sus datos permitidos y registra comentarios. Revisa las alertas de carpetas sin movimiento para organizar las gestiones pendientes.'],
                ['Prepara cotizaciones y facturación', 'Revisa destinatarios, datos y valores antes de enviar. Usa las opciones de cotizaciones y solicitudes de factura; solicita al superadministrador cualquier ajuste de correo o plantillas.']
            ]
        },
        OPERADOR: {
            label: 'Operador',
            intro: 'Trabajas sobre las carpetas disponibles para tu sucursal y mantienes su avance actualizado.',
            steps: [
                ['Encuentra la carpeta', 'Busca por número de ingreso, ROL, RUT o nombre. Si hay varias coincidencias, selecciona la carpeta correcta antes de hacer cambios.'],
                ['Actualiza el avance', 'Edita los campos habilitados y guarda comentarios claros sobre cada gestión. Revisa la documentación y las alertas que aparezcan en tu panel.'],
                ['Organiza y exporta', 'Usa los filtros por fechas, región y estado para localizar carpetas y exportar la información disponible para tu rol.'],
                ['Gestiona solicitudes de factura', 'Prepara las solicitudes desde las opciones de facturación y verifica los antecedentes antes de enviarlas. La creación inicial de registros y la administración de usuarios corresponden a otros roles.']
            ]
        },
        SUPERVISOR: {
            label: 'Supervisor',
            intro: 'Tu panel RESUMEN muestra los procesos, clientes y montos de la oficina; en REGISTROS consultas carpetas y aportas observaciones.',
            steps: [
                ['Revisa el resumen', 'En RESUMEN ves carpetas activas, ingresos del mes, montos facturados y pendientes, clientes principales y las carpetas sin movimiento hace 8 días o más. Puedes filtrar por período y sucursal.'],
                ['Consulta los antecedentes', 'Busca la carpeta por número de ingreso, ROL, RUT o nombre y verifica que corresponde al caso que revisarás.'],
                ['Revisa el historial', 'Consulta los comentarios y movimientos para conocer el avance. Tu rol no permite modificar los datos generales de las carpetas.'],
                ['Agrega observaciones', 'Guarda comentarios claros con el resultado de tu revisión. Solicita al administrador los cambios de datos, usuarios o configuración que sean necesarios.']
            ]
        },
        CONTADOR: {
            label: 'Contador',
            intro: 'Tu panel reúne las solicitudes de factura que te envía la oficina y las facturas que ya cargaste.',
            steps: [
                ['Revisa lo pendiente', 'En POR FACTURAR están las solicitudes enviadas que aún no tienen PDF, de la más antigua a la más reciente. Las que llevan 8 días o más se marcan en rojo.'],
                ['Adjunta la factura', 'Con el ícono de subir eliges el PDF, escribes el folio y la fecha de emisión. El sistema rechaza archivos que no sean PDF y folios repetidos. Al guardar, el ingreso queda como Facturada.'],
                ['Corrige si hace falta', 'Si cargaste un PDF equivocado usa Sustituir e indica el motivo; el anterior queda guardado y el cambio registrado.'],
                ['Consulta lo cargado', 'En FACTURAS CARGADAS puedes descargar o imprimir cada factura. El registro de actividad muestra quién cargó, sustituyó o descargó cada una.']
            ]
        }
    };
    const companyNote = 'Esta instalación se puede adaptar a la empresa que la utilice. Los datos de registros, nombres de sucursales, usuarios, remitente de correo y plantillas son editables según los permisos de cada rol. La administración debe completar y revisar los datos de la empresa antes de comenzar a operar.';
    return {
        get(role) {
            const guide = guides[String(role || '').toUpperCase()];
            return { ...(guide || { label: 'Usuario', intro: 'Consulta al administrador qué tareas tienes habilitadas.', steps: [] }), companyNote };
        }
    };
});
