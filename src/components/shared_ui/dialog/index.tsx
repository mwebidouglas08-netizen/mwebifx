import React from 'react';

interface DialogProps {
    children: React.ReactNode;
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    className?: string;
    footer?: React.ReactNode;
}

export const Dialog: React.FC<DialogProps> = ({
    children,
    isOpen,
    onClose,
    title,
    className = '',
    footer,
}) => {
    if (!isOpen) return null;

    return (
        <div className={`dialog-overlay ${className}`} onClick={onClose}>
            <div className="dialog-content" onClick={e => e.stopPropagation()}>
                {title && (
                    <div className="dialog-header">
                        <h2 className="dialog-title">{title}</h2>
                        <button className="dialog-close" onClick={onClose}>
                            &times;
                        </button>
                    </div>
                )}
                <div className="dialog-body">{children}</div>
                {footer && <div className="dialog-footer">{footer}</div>}
            </div>
        </div>
    );
};
