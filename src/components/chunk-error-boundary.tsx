import { Component, type ReactNode } from 'react';

const CHUNK_ERROR_RE = /Loading chunk [\w-]+ failed|Loading CSS chunk/i;

export function isChunkLoadError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    return CHUNK_ERROR_RE.test(msg);
}

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
}

/**
 * Catches only ChunkLoadError thrown by React.lazy during render.
 * Non-chunk errors are re-thrown so they reach the parent error boundary.
 *
 * On a chunk error it performs a single hard reload with a cache-busting
 * query param, guarded by sessionStorage so it never loops.
 */
export default class ChunkErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error) {
        if (!isChunkLoadError(error)) return;

        const RETRY_KEY = 'chunk_reload_attempted';
        if (sessionStorage.getItem(RETRY_KEY)) return;

        sessionStorage.setItem(RETRY_KEY, '1');
        const url = new URL(window.location.href);
        url.searchParams.set('_cb', String(Date.now()));
        setTimeout(() => window.location.replace(url.toString()), 150);
    }

    render() {
        const { error } = this.state;

        if (error && isChunkLoadError(error)) {
            return (
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: '100vh',
                        background: '#050a14',
                        color: '#fff',
                        fontFamily: 'IBM Plex Sans, sans-serif',
                        flexDirection: 'column',
                        gap: '16px',
                    }}
                >
                    <p>Loading…</p>
                    <button
                        type='button'
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '8px 24px',
                            borderRadius: '4px',
                            border: 'none',
                            background: '#ff444f',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '14px',
                        }}
                    >
                        Refresh
                    </button>
                </div>
            );
        }

        if (error) {
            // Re-throw non-chunk errors so they bubble to the nearest
            // parent error boundary instead of being swallowed here.
            throw error;
        }

        return this.props.children;
    }
}
