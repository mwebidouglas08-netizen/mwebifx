import { useState, useEffect } from 'react';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';

export const useApiBase = () => {
    const [connectionStatus, setConnectionStatus] = useState<CONNECTION_STATUS>(CONNECTION_STATUS.CONNECTING);
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
            setConnectionStatus(CONNECTION_STATUS.OPENED);
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
