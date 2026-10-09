import React from 'react';

interface SummaryProps {
    className?: string;
}

const Summary: React.FC<SummaryProps> = ({ className = '' }) => {
    return <div className={`summary ${className}`} />;
};

export default Summary;
