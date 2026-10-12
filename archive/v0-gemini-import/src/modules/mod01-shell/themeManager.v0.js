/**
 * vCGE Theme Manager & Persistence Module
 * Created by raven575 and Gemini
 */
(function() {
    const THEME_KEY = 'vcge_theme_preference';
    
    function initTheme() {
        const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
        const html = document.documentElement;
        if (savedTheme === 'light') {
            html.classList.remove('dark');
        } else {
            html.classList.add('dark');
        }
        
        const toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn) {
            toggleBtn.textContent = savedTheme === 'light' ? '☀️' : '🌙';
            toggleBtn.addEventListener('click', () => {
                const isDark = html.classList.contains('dark');
                if (isDark) {
                    html.classList.remove('dark');
                    localStorage.setItem(THEME_KEY, 'light');
                    toggleBtn.textContent = '☀️';
                } else {
                    html.classList.add('dark');
                    localStorage.setItem(THEME_KEY, 'dark');
                    toggleBtn.textContent = '🌙';
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTheme);
    } else {
        initTheme();
    }
})();