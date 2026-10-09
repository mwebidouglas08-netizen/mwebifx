import React from 'react';

interface MoneyProps {
    amount: number;
    currency?: string;
    className?: string;
    showCurrency?: boolean;
    decimalPlaces?: number;
}

const Money: React.FC<MoneyProps> = ({
    amount,
    currency = 'USD',
    className = '',
    showCurrency = true,
    decimalPlaces = 2,
}) => {
    const formatted = amount.toLocaleString('en-US', {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
    });

    return (
        <span className={`money ${className}`}>
            {formatted}
            {showCurrency && <span className="money-currency"> {currency}</span>}
        </span>
    );
};

export default Money;
