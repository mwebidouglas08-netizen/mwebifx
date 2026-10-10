import { useState, useEffect } from 'react';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';

export const useApiBase = () => {
    // The stub api_base.init() succeeds synchronously and sets api_base.api,
    // so the connection is considered OPENED immediately. Without this the app
    // would sit on the loading screen forever for logged-out visitors, because
    // the only other place OPENED was set required an active_loginid in
    // localStorage (i.e. an already-authenticated user).
    const [connectionStatus, setConnectionStatus] = useState<CONNECTION_STATUS>(CONNECTION_STATUS.OPENED);
    const [isAuthorizing, setIsAuthorizing] = useState(false);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [accountList, setAccountList] = useState<any[]>([]);
    const [activeLoginid, setActiveLoginid] = useState<string | null>(null);
    const [authData, setAuthData] = useState<any>(null);

    useEffect(() => {
        const loginid = localStorage.getItem('active_loginid');
        if (loginid) {
            setActiveLoginid(loginid);
            setIsAuthorized(true);
        }
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
