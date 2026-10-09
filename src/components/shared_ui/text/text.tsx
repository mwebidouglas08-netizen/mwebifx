import React from 'react';

interface TextProps {
    children: React.ReactNode;
    as?: 'span' | 'p' | 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    className?: string;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
    weight?: 'normal' | 'bold' | 'bolder' | 'lighter';
    color?: string;
    align?: 'left' | 'center' | 'right' | 'justify';
    id?: string;
    onClick?: () => void;
    style?: React.CSSProperties;
}

const Text: React.FC<TextProps> = ({
    children,
    as: Tag = 'span',
    className = '',
    size,
    weight,
    color,
    align,
    id,
    onClick,
    style,
}) => {
    const sizeMap: Record<string, string> = {
        xs: '0.75rem',
        sm: '0.875rem',
        md: '1rem',
        lg: '1.25rem',
        xl: '1.5rem',
        xxl: '2rem',
    };

    const computedStyle: React.CSSProperties = {
        ...style,
        ...(size ? { fontSize: sizeMap[size] } : {}),
        ...(weight ? { fontWeight: weight } : {}),
        ...(color ? { color } : {}),
        ...(align ? { textAlign: align } : {}),
    };

    return (
        <Tag id={id} className={className} style={computedStyle} onClick={onClick}>
            {children}
        </Tag>
    );
};

export default Text;
