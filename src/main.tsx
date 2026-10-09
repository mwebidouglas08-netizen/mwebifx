import { createRoot } from 'react-dom/client';
import App from './app/App';

const CHUNK_ERROR_RE = /Loading chunk [\w-]+ failed|Loading CSS chunk/i;
const RETRY_KEY = 'chunk_reload_attempted';

function isChunkLoadError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    return CHUNK_ERROR_RE.test(msg);
}

function handleChunkLoadError(error: unknown): boolean {
    if (!isChunkLoadError(error)) return false;
    if (sessionStorage.getItem(RETRY_KEY)) return false;
    sessionStorage.setItem(RETRY_KEY, '1');
    const url = new URL(window.location.href);
    url.searchParams.set('_cb', String(Date.now()));
    window.location.replace(url.toString());
    return true;
}

window.addEventListener('unhandledrejection', event => {
    if (handleChunkLoadError(event.reason)) {
        event.preventDefault();
    }
});

window.addEventListener('error', event => {
    handleChunkLoadError(event.error);
});

setTimeout(() => sessionStorage.removeItem(RETRY_KEY), 15000);

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = createRoot(rootElement);
    root.render(<App />);
}
