/**
 * vCGE Theme Manager & Persistence Module
 * Created by raven575, Gemini & Claude
 */
const THEME_KEY = 'vcge_theme_preference';

// Light/dark mode for the whole app (Tailwind `darkMode: 'class'`). Only the preference is persisted.
export function initTheme(toggleBtn) {
    const html = document.documentElement;
    const apply = (mode) => {
        html.classList.toggle('dark', mode !== 'light');
        if (toggleBtn) toggleBtn.textContent = mode === 'light' ? '☀️' : '🌙';
    };
    apply(localStorage.getItem(THEME_KEY) || 'dark');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const next = html.classList.contains('dark') ? 'light' : 'dark';
            localStorage.setItem(THEME_KEY, next);
            apply(next);
        });
    }
}
