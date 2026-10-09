import React from 'react';

interface MobileWrapperProps {
    children: React.ReactNode;
    className?: string;
}

export const MobileWrapper: React.FC<MobileWrapperProps> = ({ children, className = '' }) => {
    return <div className={`mobile-wrapper ${className}`}>{children}</div>;
};

export default MobileWrapper;
