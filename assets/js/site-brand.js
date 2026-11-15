// Aplica la identidad de assets/site/site.js a la página: título, nombre visible y textos del logo.
(function () {
    const name = (window.SITE_CONFIG && window.SITE_CONFIG.appName) || 'SIA Core';
    if (document.title && document.title.indexOf(name) === -1) {
        document.title = document.title + ' - ' + name;
    }

    // Color de la barra del navegador y de la app instalada: lo define cada sitio en site.js.
    const themeColor = window.SITE_CONFIG && window.SITE_CONFIG.themeColor;
    if (themeColor && document.head && !document.querySelector('meta[name="theme-color"]')) {
        const meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.content = themeColor;
        document.head.appendChild(meta);
    }

    function apply() {
        document.querySelectorAll('[data-site-name]').forEach(function (node) {
            node.textContent = name;
        });
        document.querySelectorAll('img[data-site-logo]').forEach(function (image) {
            image.alt = name;
        });
        document.querySelectorAll('[data-site-placeholder]').forEach(function (input) {
            input.placeholder = name;
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }
})();
