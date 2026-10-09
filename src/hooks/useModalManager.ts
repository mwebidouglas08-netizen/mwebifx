import { useState, useCallback } from 'react';

const useModalManager = () => {
    const [openModals, setOpenModals] = useState<Set<string>>(new Set());

    const showModal = useCallback((id: string) => {
        setOpenModals(prev => new Set(prev).add(id));
    }, []);

    const hideModal = useCallback((id?: string) => {
        setOpenModals(prev => {
            const next = new Set(prev);
            if (id) next.delete(id);
            else next.clear();
            return next;
        });
    }, []);

    const isModalOpenFor = useCallback((id: string) => openModals.has(id), [openModals]);

    return { showModal, hideModal, isModalOpenFor };
};

export default useModalManager;
