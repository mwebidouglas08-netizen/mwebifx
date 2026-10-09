import { lazy } from 'react';
import type { ComponentType } from 'react';
import { isChunkLoadError } from '@/components/chunk-error-boundary';

const RETRY_KEY = 'chunk_reload_attempted';

/**
 * Wraps a dynamic import so that a ChunkLoadError triggers a single
 * cache-busted page reload instead of propagating to React.lazy's rejection.
 *
 * Webpack caches the rejected import() promise, so retrying the same import()
 * is futile — a full reload is the only reliable recovery.
 *
 * On success the sessionStorage retry flag is cleared so that a future
 * ChunkLoadError (e.g. after a redeploy) can trigger one fresh reload.
 */
export function retryableLazy<T extends ComponentType<Record<string, never>>>(
    loader: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
    return lazy(() =>
        loader()
            .then(mod => {
                sessionStorage.removeItem(RETRY_KEY);
                return mod;
            })
            .catch(error => {
                if (isChunkLoadError(error) && !sessionStorage.getItem(RETRY_KEY)) {
                    sessionStorage.setItem(RETRY_KEY, '1');
                    const url = new URL(window.location.href);
                    url.searchParams.set('_cb', String(Date.now()));
                    window.location.replace(url.toString());
                    // Never-resolving promise keeps React in the Suspense
                    // fallback while the browser navigates away.
                    return new Promise<never>(() => {});
                }
                throw error;
            })
    );
}
