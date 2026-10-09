import React from 'react';

interface DesktopWrapperProps {
    children: React.ReactNode;
    className?: string;
}

export const DesktopWrapper: React.FC<DesktopWrapperProps> = ({ children, className = '' }) => {
    return <div className={`desktop-wrapper ${className}`}>{children}</div>;
};
