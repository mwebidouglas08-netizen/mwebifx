import { createRoot } from 'react-dom/client';
import App from './app/App';
import { getUrlBase } from './components/shared/utils/url';
import { isPreviewMode, PREVIEW_BASE_PATH } from './utils/is-preview-mode';
// Global stylesheet: defines the .theme--light / .theme--dark CSS variables
// (--general-main-1, --text-prominent, --border-normal, …) plus the body font
// and background. Dropped somewhere after 4037a32, which left every
// var(--theme-token) in the app silently unresolved — light mode rendered as
// white text on a transparent background.
import './styles/index.scss';

// Runtime public path used to build asset URLs (audio, Blockly media, favicon).
// Restored from src/public-path.ts (deleted in 956dcae) — without it every asset
// URL renders as "undefinedassets/..." and 404s.
window.__webpack_public_path__ = isPreviewMode() ? `${PREVIEW_BASE_PATH}/` : getUrlBase('/');


// DOM-level error fallback: if the bundle crashes before React mounts,
// render the error directly into #root so the user sees it instead of
// a blank screen. This bypasses React entirely.
let fatalErrorShown = false;
function showFatalError(message: string) {
    if (fatalErrorShown) return;
    fatalErrorShown = true;
    console.error('[FATAL]', message);
    const root = document.getElementById('root');
    if (!root) return;
    root.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#050a14;color:#fff;font-family:sans-serif;flex-direction:column;gap:16px;padding:24px;text-align:center">' +
        '<p style="font-size:18px;font-weight:600">Something went wrong</p>' +
        '<p style="font-size:14px;color:#aaa;max-width:600px;word-break:break-word">' +
        message.replace(/</g, '&lt;') +
        '</p>' +
        '<button onclick="location.reload()" style="padding:8px 24px;border-radius:4px;border:none;background:#ff444f;color:#fff;cursor:pointer;font-size:14px">Refresh</button>' +
        '</div>';
}

window.addEventListener('error', event => {
    if (event.error) {
        showFatalError(event.error.message || String(event.error));
    }
});

window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    showFatalError(msg);
});

try {
    // Unregister any stale service workers left over from prior deployments.
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations.forEach(registration => registration.unregister());
        });
    }

    const rootElement = document.getElementById('root');
    if (rootElement) {
        const root = createRoot(rootElement);
        root.render(<App />);
    }
} catch (err) {
    showFatalError(err instanceof Error ? err.message : String(err));
}
