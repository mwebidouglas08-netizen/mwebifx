import React from 'react';

interface DrawerProps {
    children: React.ReactNode;
    isOpen: boolean;
    onClose: () => void;
    position?: 'left' | 'right';
    title?: string;
    className?: string;
}

const Drawer: React.FC<DrawerProps> = ({
    children,
    isOpen,
    onClose,
    position = 'right',
    title,
    className = '',
}) => {
    if (!isOpen) return null;

    return (
        <div className={`drawer-overlay ${className}`} onClick={onClose}>
            <div
                className={`drawer-content drawer-${position}`}
                onClick={e => e.stopPropagation()}
            >
                {title && (
                    <div className="drawer-header">
                        <h2 className="drawer-title">{title}</h2>
                        <button className="drawer-close" onClick={onClose}>
                            &times;
                        </button>
                    </div>
                )}
                <div className="drawer-body">{children}</div>
            </div>
        </div>
    );
};

export default Drawer;
