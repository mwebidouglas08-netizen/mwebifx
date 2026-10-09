import React from 'react';

interface TradeAnimationProps {
    className?: string;
}

const TradeAnimation: React.FC<TradeAnimationProps> = ({ className = '' }) => {
    return <div className={`trade-animation ${className}`} />;
};

export default TradeAnimation;
