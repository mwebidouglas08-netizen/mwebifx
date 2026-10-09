import React, { useRef, useState, useCallback } from 'react';
import useOnClickOutside from '@/hooks/useOnClickOutside';

interface PopoverProps {
    children: React.ReactNode;
    content: React.ReactNode;
    trigger?: 'click' | 'hover';
    placement?: 'top' | 'bottom' | 'left' | 'right';
    className?: string;
}

export const Popover: React.FC<PopoverProps> = ({
    children,
    content,
    trigger = 'click',
    placement = 'bottom',
    className = '',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const handleClickOutside = useCallback(() => {
        setIsOpen(false);
    }, []);

    useOnClickOutside(ref, handleClickOutside);

    const toggle = () => setIsOpen(prev => !prev);

    const handleMouseEnter = () => {
        if (trigger === 'hover') setIsOpen(true);
    };

    const handleMouseLeave = () => {
        if (trigger === 'hover') setIsOpen(false);
    };

    return (
        <div
            ref={ref}
            className={`popover-container ${className}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div onClick={trigger === 'click' ? toggle : undefined}>
                {children}
            </div>
            {isOpen && (
                <div className={`popover-content popover-${placement}`}>
                    {content}
                </div>
            )}
        </div>
    );
};
