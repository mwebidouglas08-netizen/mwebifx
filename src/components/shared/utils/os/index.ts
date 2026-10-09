export const getOS = (): string => {
    const userAgent = window.navigator.userAgent;
    if (/Windows/i.test(userAgent)) return 'Windows';
    if (/Mac/i.test(userAgent)) return 'MacOS';
    if (/Linux/i.test(userAgent)) return 'Linux';
    if (/Android/i.test(userAgent)) return 'Android';
    if (/iOS|iPhone|iPad|iPod/i.test(userAgent)) return 'iOS';
    return 'Unknown';
};

export const isMobile = (): boolean => /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent);

export const isDesktop = (): boolean => !isMobile();
