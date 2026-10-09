import { useState, useEffect } from 'react';

const useThemeSwitcher = () => {
    const [is_dark_mode_on, setIsDarkModeOn] = useState(() => {
        return localStorage.getItem('theme') === 'dark';
    });

    useEffect(() => {
        localStorage.setItem('theme', is_dark_mode_on ? 'dark' : 'light');
    }, [is_dark_mode_on]);

    return { is_dark_mode_on, setIsDarkModeOn };
};

export default useThemeSwitcher;
