import React from 'react';

interface ThemedScrollbarsProps {
    children: React.ReactNode;
    className?: string;
    autoHide?: boolean;
}

const ThemedScrollbars: React.FC<ThemedScrollbarsProps> = ({
    children,
    className = '',
    autoHide = true,
}) => {
    return (
        <div
            className={`themed-scrollbars ${autoHide ? 'auto-hide' : ''} ${className}`}
        >
            {children}
        </div>
    );
};

export default ThemedScrollbars;
