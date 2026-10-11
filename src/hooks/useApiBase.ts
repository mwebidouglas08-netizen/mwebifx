import { useState, useEffect } from 'react';
import {
    CONNECTION_STATUS,
    connectionStatus$,
    isAuthorizing$,
    isAuthorized$,
    account_list$,
    authData$,
} from '@/external/bot-skeleton/services/api/observables/connection-status-stream';

/**
 * Mirror of the api_base auth state for React components.
 *
 * These values are NOT component state — they live in the RxJS streams that
 * `api-base.ts` writes to after `authorizeAndSubscribe()` resolves. This hook
 * simply mirrors them so `observer`-free components can read them.
 *
 * It used to be per-component `useState` seeded once from localStorage, and
 * nothing ever called the setters it exported. That made `accountList` a
 * permanent `[]`, so the header's account switcher computed `isSingleAccount`
 * and its dropdown could never open — demo/real switching was unreachable.
 */
export const useApiBase = () => {
    const [connectionStatus, setConnectionStatus] = useState<CONNECTION_STATUS>(CONNECTION_STATUS.OPENED);
    const [isAuthorizing, setIsAuthorizing] = useState(false);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [accountList, setAccountList] = useState<any[]>([]);
    const [activeLoginid, setActiveLoginid] = useState<string | null>(null);
    const [authData, setAuthData] = useState<any>(null);

    useEffect(() => {
        const subs = [
            connectionStatus$.subscribe(status => setConnectionStatus(status as CONNECTION_STATUS)),
            isAuthorizing$.subscribe(value => setIsAuthorizing(value)),
            isAuthorized$.subscribe(value => setIsAuthorized(value)),
            account_list$.subscribe(list => setAccountList(Array.isArray(list) ? list : [])),
            authData$.subscribe(data => {
                setAuthData(data);
                if (data?.loginid) setActiveLoginid(data.loginid);
            }),
        ];

        // Seed from localStorage so the switcher has the active account before
        // the first authorize response lands (BehaviourSubjects replay on
        // subscribe, so this only matters on a cold page load).
        const loginid = localStorage.getItem('active_loginid');
        if (loginid) {
            setActiveLoginid(prev => prev ?? loginid);
        }

        return () => subs.forEach(sub => sub.unsubscribe());
    }, []);

    return {
        connectionStatus,
        setConnectionStatus,
        isAuthorizing,
        setIsAuthorizing,
        isAuthorized,
        setIsAuthorized,
        accountList,
        setAccountList,
        activeLoginid,
        setActiveLoginid,
        authData,
        setAuthData,
    };
};

export default useApiBase;
