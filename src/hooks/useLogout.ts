import { useCallback } from 'react';
import { useStore } from '@/hooks/useStore';

export const useLogout = () => {
    const store = useStore();
    const { client } = store ?? {};

    const handleLogout = useCallback(() => {
        client?.logout();
    }, [client]);

    return handleLogout;
};
