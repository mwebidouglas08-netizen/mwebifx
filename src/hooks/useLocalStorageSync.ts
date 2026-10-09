import { useState, useCallback } from 'react';

export const useLocalStorageSync = () => {
    const [showAccountChangeModal, setShowAccountChangeModal] = useState(false);

    const handleReload = useCallback(() => {
        window.location.reload();
    }, []);

    const handleModalClose = useCallback(() => {
        setShowAccountChangeModal(false);
    }, []);

    return { showAccountChangeModal, handleReload, handleModalClose };
};
