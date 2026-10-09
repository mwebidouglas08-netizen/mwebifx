import React, { useEffect } from 'react';

interface ModalProps {
    children: React.ReactNode;
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    className?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

const Modal: React.FC<ModalProps> = ({
    children,
    isOpen,
    onClose,
    title,
    className = '',
    size = 'md',
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

    const sizeMap: Record<string, string> = {
        sm: '400px',
        md: '600px',
        lg: '800px',
        xl: '1000px',
    };

    return (
        <div className={`modal-overlay ${className}`} onClick={onClose}>
            <div
                className="modal-content"
                style={{ maxWidth: sizeMap[size] }}
                onClick={e => e.stopPropagation()}
            >
                {title && (
                    <div className="modal-header">
                        <h2 className="modal-title">{title}</h2>
                        <button className="modal-close" onClick={onClose}>
                            &times;
                        </button>
                    </div>
                )}
                <div className="modal-body">{children}</div>
            </div>
        </div>
    );
};

export default Modal;
