import React from 'react';

type IconProps = {
    icon: string;
    size?: string | number;
    className?: string;
};

export const Icon: React.FC<IconProps> = ({ icon, size = 24, className }) => (
    <svg width={size} height={size} className={className} data-icon={icon} aria-hidden='true'>
        <rect width='100%' height='100%' fill='currentColor' opacity='0.2' />
    </svg>
);
