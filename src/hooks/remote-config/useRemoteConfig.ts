import { useState, useEffect } from 'react';

const useRemoteConfig = (_enabled: boolean = true) => {
    const [data, setData] = useState<any>({});

    useEffect(() => {
        setData({ cs_chat_livechat: false });
    }, []);

    return { data };
};

export default useRemoteConfig;
