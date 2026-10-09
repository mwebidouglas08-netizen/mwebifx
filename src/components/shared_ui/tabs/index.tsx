import React, { useState } from 'react';

interface Tab {
    label: string;
    content: React.ReactNode;
}

interface TabsProps {
    tabs: Tab[];
    className?: string;
    defaultIndex?: number;
    onChange?: (index: number) => void;
}

const Tabs: React.FC<TabsProps> = ({
    tabs,
    className = '',
    defaultIndex = 0,
    onChange,
}) => {
    const [activeIndex, setActiveIndex] = useState(defaultIndex);

    const handleTabClick = (index: number) => {
        setActiveIndex(index);
        onChange?.(index);
    };

    return (
        <div className={`tabs-container ${className}`}>
            <div className="tabs-header">
                {tabs.map((tab, index) => (
                    <button
                        key={index}
                        className={`tab-button ${index === activeIndex ? 'active' : ''}`}
                        onClick={() => handleTabClick(index)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="tabs-content">
                {tabs[activeIndex]?.content}
            </div>
        </div>
    );
};

export default Tabs;
