import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    fullWidth?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
    iconPosition?: 'left' | 'right';
}

const Button: React.FC<ButtonProps> = ({
    children,
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    loading = false,
    icon,
    iconPosition = 'left',
    disabled,
    className = '',
    ...rest
}) => {
    const baseStyles: React.CSSProperties = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        border: 'none',
        borderRadius: '4px',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        fontWeight: 500,
        opacity: disabled || loading ? 0.6 : 1,
        width: fullWidth ? '100%' : 'auto',
        transition: 'background-color 0.2s, opacity 0.2s',
    };

    const sizeStyles: Record<string, React.CSSProperties> = {
        sm: { padding: '6px 12px', fontSize: '0.75rem' },
        md: { padding: '8px 16px', fontSize: '0.875rem' },
        lg: { padding: '12px 24px', fontSize: '1rem' },
    };

    const variantStyles: Record<string, React.CSSProperties> = {
        primary: { backgroundColor: '#377cfc', color: '#fff' },
        secondary: { backgroundColor: '#e6e9e9', color: '#333' },
        outline: { backgroundColor: 'transparent', color: '#377cfc', border: '1px solid #377cfc' },
        ghost: { backgroundColor: 'transparent', color: '#377cfc' },
        danger: { backgroundColor: '#ff444f', color: '#fff' },
    };

    const style: React.CSSProperties = {
        ...baseStyles,
        ...sizeStyles[size],
        ...variantStyles[variant],
    };

    return (
        <button
            className={className}
            style={style}
            disabled={disabled || loading}
            {...rest}
        >
            {icon && iconPosition === 'left' && <span>{icon}</span>}
            {loading ? <span className="button-loader">Loading...</span> : children}
            {icon && iconPosition === 'right' && <span>{icon}</span>}
        </button>
    );
};

export default Button;
