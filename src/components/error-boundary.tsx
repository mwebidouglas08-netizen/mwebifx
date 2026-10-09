import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
}

/**
 * Standard React error boundary. Displays the error message so failures
 * are visible instead of producing a blank screen.
 */
export default class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('ErrorBoundary caught:', error, info.componentStack);
    }

    render() {
        if (this.state.error) {
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
                        padding: '24px',
                        textAlign: 'center',
                    }}
                >
                    <p style={{ fontSize: '18px', fontWeight: 600 }}>Something went wrong</p>
                    <p style={{ fontSize: '14px', color: '#aaa', maxWidth: '600px', wordBreak: 'break-word' }}>
                        {this.state.error.message}
                    </p>
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
