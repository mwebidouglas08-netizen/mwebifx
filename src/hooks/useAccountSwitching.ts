import { useEffect } from 'react';
import { useStore } from '@/hooks/useStore';

export const useAccountSwitching = () => {
    const store = useStore();
    const { client } = store ?? {};

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const account_id = params.get('account_id');
        if (account_id) {
            localStorage.setItem('active_loginid', account_id);
            client?.setLoginId(account_id);
        }
    }, [client]);
};
