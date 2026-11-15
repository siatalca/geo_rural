// Botón «INSTALAR APP» del login: aparece solo cuando el navegador ofrece instalar el sistema como app
// (Chrome y Edge lanzan beforeinstallprompt) y no se está usando ya la app instalada. En Firefox o Safari
// el evento no existe y el botón sigue oculto.
(function () {
    const button = document.getElementById('installAppBtn');
    if (!button) return;

    let installPrompt = null;
    const isInstalledApp = function () {
        return Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    };

    window.addEventListener('beforeinstallprompt', function (event) {
        // Se guarda el aviso para lanzarlo desde el botón; Chrome sigue mostrando su ícono en la barra de direcciones.
        event.preventDefault();
        if (isInstalledApp()) return;
        installPrompt = event;
        button.hidden = false;
    });

    button.addEventListener('click', function () {
        if (!installPrompt) return;
        const promptEvent = installPrompt;
        installPrompt = null;
        button.hidden = true;
        // El aviso solo se puede lanzar una vez; si se cancela, el navegador vuelve a ofrecerlo más tarde.
        Promise.resolve(promptEvent.prompt()).catch(function () {});
    });

    window.addEventListener('appinstalled', function () {
        installPrompt = null;
        button.hidden = true;
    });
})();
