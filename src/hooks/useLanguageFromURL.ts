import { useEffect } from 'react';
import { useStore } from '@/hooks/useStore';

export const useLanguageFromURL = () => {
    const store = useStore();
    const { common } = store ?? {};

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const lang = params.get('lang');
        if (lang && common) {
            common.setCurrentLanguage(lang.toUpperCase());
        }
    }, [common]);
};
