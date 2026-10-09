import React from 'react';

interface CheckboxProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
    disabled?: boolean;
    className?: string;
    id?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
    checked,
    onChange,
    label,
    disabled = false,
    className = '',
    id,
}) => {
    return (
        <label className={`checkbox-container ${className}`}>
            <input
                type="checkbox"
                id={id}
                checked={checked}
                onChange={e => onChange(e.target.checked)}
                disabled={disabled}
                className="checkbox-input"
            />
            {label && <span className="checkbox-label">{label}</span>}
        </label>
    );
};
