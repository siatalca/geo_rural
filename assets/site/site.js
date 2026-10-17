// Identidad de ESTE sitio. Es el único archivo de código que cambia entre instalaciones
// (Predia, Geo Rural…): no copiarlo al sincronizar el código común. Sin secretos: se publica.
(function (root, factory) {
    const site = factory();
    if (typeof module === 'object' && module.exports) module.exports = site;
    else root.SITE_CONFIG = site;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    return {
        appName: 'Geo Rural',
        // Prefijo de localStorage/sessionStorage y nombre de la cookie de sesión.
        storagePrefix: 'geo_rural',
        sessionCookie: 'geo_rural_session',
        // Carpeta pública bajo la que se sirve el sitio ('' si está en la raíz del dominio).
        basePath: '/geo_rural',
        loginNoticeUrls: {
            dev: 'http://localhost/geo_rural/registro/login/registro.html',
            prod: 'https://mi-registro.cl/geo_rural/registro/login/registro.html'
        },
        // Puerto Node local al que apunta el navegador cuando la página la sirve Apache/XAMPP.
        api: { localPort: 3001, portRange: [3001, 3001] },
        // Geo Rural aún no figura en C:\SIA\PUERTOS.md: conserva su puerto actual sin forzar la regla de pares.
        server: { defaultPort: 3001, portRange: null, requireEvenPort: false },
        // La base debe llamarse así; evita conectar por error a la base de otro sitio.
        database: { defaultName: 'geo_rural', namePattern: '^geo_rural(?:_[a-z0-9]+)*$' },
        // Correo al que responde el cliente al recibir una cotización ('' = el remitente).
        replyTo: 'georural.verificaciones@gmail.com',
        cotizacionPdf: '/assets/Carta de Cotizacion Geo Rural.pdf',
        firma: {
            personas: ['Pedro Antonio Gerardo Herrera Mendez', 'Pedro Ignacio Albornoz Sateler'],
            empresa: 'GEO RURAL VERIFICACIONES LIMITADA',
            direccion: 'Uno Norte N° 801, oficina 306, Talca'
        },
        demoAddress: 'Uno Norte 801, Oficina 306'
    };
});
