import React, { useEffect } from 'react';

interface MobileDialogProps {
    children: React.ReactNode;
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    className?: string;
}

export const MobileDialog: React.FC<MobileDialogProps> = ({
    children,
    isOpen,
    onClose,
    title,
    className = '',
}) => {
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            document.addEventListener('keydown', handleEsc);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleEsc);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className={`mobile-dialog-overlay ${className}`} onClick={onClose}>
            <div className="mobile-dialog-content" onClick={e => e.stopPropagation()}>
                {title && (
                    <div className="mobile-dialog-header">
                        <h2 className="mobile-dialog-title">{title}</h2>
                        <button className="mobile-dialog-close" onClick={onClose}>
                            &times;
                        </button>
                    </div>
                )}
                <div className="mobile-dialog-body">{children}</div>
            </div>
        </div>
    );
};
