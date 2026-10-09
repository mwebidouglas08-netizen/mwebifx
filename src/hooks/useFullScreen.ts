import { useState, useCallback } from 'react';

const useFullScreen = () => {
    const [isFullScreen, setIsFullScreen] = useState(false);

    const toggleFullScreen = useCallback(() => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.();
            setIsFullScreen(true);
        } else {
            document.exitFullscreen?.();
            setIsFullScreen(false);
        }
    }, []);

    return { isFullScreen, toggleFullScreen };
};

export default useFullScreen;
