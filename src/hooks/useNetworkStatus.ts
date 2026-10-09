import { useState, useEffect } from 'react';

const useNetworkStatus = (): 'online' | 'offline' | 'blinking' => {
    const [status, setStatus] = useState<'online' | 'offline' | 'blinking'>('online');

    useEffect(() => {
        const handleOnline = () => setStatus('online');
        const handleOffline = () => setStatus('offline');
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return status;
};

export default useNetworkStatus;
