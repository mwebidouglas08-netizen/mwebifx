import { createRoot } from 'react-dom/client';
import App from './app/App';
import ChunkErrorBoundary from './components/chunk-error-boundary';

// Unregister any stale service workers left over from prior deployments that
// may be intercepting chunk requests and serving outdated responses.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => registration.unregister());
    });
}

// Clear the retry flag once the app has booted successfully so a future
// ChunkLoadError (e.g. after a redeploy) can trigger one fresh reload.
setTimeout(() => sessionStorage.removeItem('chunk_reload_attempted'), 10000);

// Safety net: if React somehow lets a chunk error escape to the window level
// (e.g. thrown outside render), still force one cache-busted reload.
const CHUNK_ERROR_RE = /Loading chunk [\w-]+ failed|Loading CSS chunk/i;

function isChunkLoadError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    return CHUNK_ERROR_RE.test(msg);
}

window.addEventListener('unhandledrejection', event => {
    if (!isChunkLoadError(event.reason)) return;
    if (sessionStorage.getItem('chunk_reload_attempted')) return;
    sessionStorage.setItem('chunk_reload_attempted', '1');
    const url = new URL(window.location.href);
    url.searchParams.set('_cb', String(Date.now()));
    window.location.replace(url.toString());
    event.preventDefault();
});

window.addEventListener('error', event => {
    if (!isChunkLoadError(event.error)) return;
    if (sessionStorage.getItem('chunk_reload_attempted')) return;
    sessionStorage.setItem('chunk_reload_attempted', '1');
    const url = new URL(window.location.href);
    url.searchParams.set('_cb', String(Date.now()));
    window.location.replace(url.toString());
});

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = createRoot(rootElement);
    root.render(
        <ChunkErrorBoundary>
            <App />
        </ChunkErrorBoundary>
    );
}
