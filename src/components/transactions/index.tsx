import React from 'react';

interface TransactionsProps {
    className?: string;
}

const Transactions: React.FC<TransactionsProps> = ({ className = '' }) => {
    return <div className={`transactions ${className}`} />;
};

export default Transactions;
