import React from 'react';

interface UnhandledErrorModalProps {
    isOpen: boolean;
    onClose: () => void;
    className?: string;
    error?: Error | string;
}

export const UnhandledErrorModal: React.FC<UnhandledErrorModalProps> = ({
    isOpen,
    onClose,
    className = '',
    error,
}) => {
    if (!isOpen) return null;

    const message = error instanceof Error ? error.message : error || 'An unexpected error occurred.';

    return (
        <div className={`unhandled-error-modal ${className}`}>
            <div className="unhandled-error-modal-content">
                <h2>Something went wrong</h2>
                <p>{message}</p>
                <button onClick={onClose}>Dismiss</button>
            </div>
        </div>
    );
};
