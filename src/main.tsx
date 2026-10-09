import { createRoot } from 'react-dom/client';
import App from './app/App';
import ErrorBoundary from './components/error-boundary';

// Unregister any stale service workers left over from prior deployments that
// may be intercepting chunk requests and serving outdated responses.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => registration.unregister());
    });
}

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = createRoot(rootElement);
    root.render(
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    );
}
