import brandConfig from '../../brand.config.json';

const config = brandConfig as Record<string, any>;

export const getAppName = (): string => {
    return config?.platform?.name ?? config?.brand_name ?? 'Deriv Bot';
};

export const getLogoCandidates = (): string[] => {
    const logoPath = config?.platform?.logo_path;
    const candidates = [
        ...(logoPath ? [logoPath] : []),
        '/logo.svg',
        '/logo.png',
        '/brand-logo.svg',
        '/brand-logo.png',
    ];
    return candidates;
};

export const getShowAppName = (): boolean => {
    return config?.platform?.show_name !== false;
};
