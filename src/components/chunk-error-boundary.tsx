import { Component, type ReactNode } from 'react';

const CHUNK_ERROR_RE = /Loading chunk [\w-]+ failed|Loading CSS chunk/i;

function isChunkLoadError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    return CHUNK_ERROR_RE.test(msg);
}

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
}

/**
 * Catches ChunkLoadError thrown by React.lazy during render and performs a
 * single hard reload with a cache-busting query param. Without this the error
 * bubbles to React's default error boundary ("Unexpected Application Error!")
 * and the window-level handlers in main.tsx never fire.
 */
export default class ChunkErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error) {
        if (!isChunkLoadError(error)) return;

        const RETRY_KEY = 'chunk_reload_attempted';
        if (sessionStorage.getItem(RETRY_KEY)) return;

        sessionStorage.setItem(RETRY_KEY, '1');
        const url = new URL(window.location.href);
        url.searchParams.set('_cb', String(Date.now()));
        // Small delay lets React finish painting the fallback before navigating.
        setTimeout(() => window.location.replace(url.toString()), 150);
    }

    render() {
        if (this.state.hasError) {
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
        return this.props.children;
    }
}
