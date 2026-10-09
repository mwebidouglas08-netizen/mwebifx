import { useStore } from '@/hooks/useStore';

const useActiveAccount = (_params?: { allBalanceData?: any; directBalance?: any }) => {
    const store = useStore();
    const { client } = store ?? {};
    return {
        data: client
            ? {
                  loginid: client.loginid,
                  currency: client.currency,
                  balance: client.balance,
                  isVirtual: client.loginid?.startsWith('VRT') || client.loginid?.startsWith('VRTC'),
              }
            : null,
    };
};

export default useActiveAccount;
