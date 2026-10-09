export type AuthConfig = {
    clientId: string;
    redirectUri: string;
    scopes: string;
    lang?: string;
    affiliateToken?: string;
    affiliateTokenParam?: string;
    utmCampaign?: string;
    utmSource?: string;
    utmMedium?: string;
};

export const buildAuthorizationUrl = async (_config: AuthConfig): Promise<string> => {
    return '';
};

export const buildSignUpUrl = async (_config: AuthConfig): Promise<string> => {
    return '';
};

export const getAuthInfo = (): { access_token?: string } | null => {
    try {
        const raw = localStorage.getItem('auth_info');
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

export const parseReferralLink = (
    link: string
): { affiliateToken?: string; affiliateTokenParam?: string; utmCampaign?: string; utmSource?: string; utmMedium?: string } | null => {
    try {
        const url = new URL(link);
        const params = url.searchParams;
        return {
            affiliateToken: params.get('affiliate_token') || undefined,
            affiliateTokenParam: params.get('affiliate_token_param') || undefined,
            utmCampaign: params.get('utm_campaign') || undefined,
            utmSource: params.get('utm_source') || undefined,
            utmMedium: params.get('utm_medium') || undefined,
        };
    } catch {
        return null;
    }
};

export const parseLandingParams = (): {
    affiliateToken?: string;
    affiliateTokenParam?: string;
    utmCampaign?: string;
    utmSource?: string;
    utmMedium?: string;
} | null => {
    const params = new URLSearchParams(window.location.search);
    const result: {
        affiliateToken?: string;
        affiliateTokenParam?: string;
        utmCampaign?: string;
        utmSource?: string;
        utmMedium?: string;
    } = {};
    let hasAny = false;
    if (params.get('t')) {
        result.affiliateToken = params.get('t') || undefined;
        hasAny = true;
    }
    if (params.get('affiliate_token')) {
        result.affiliateToken = params.get('affiliate_token') || undefined;
        hasAny = true;
    }
    if (params.get('affiliate_token_param')) {
        result.affiliateTokenParam = params.get('affiliate_token_param') || undefined;
        hasAny = true;
    }
    if (params.get('utm_campaign')) {
        result.utmCampaign = params.get('utm_campaign') || undefined;
        hasAny = true;
    }
    if (params.get('utm_source')) {
        result.utmSource = params.get('utm_source') || undefined;
        hasAny = true;
    }
    if (params.get('utm_medium')) {
        result.utmMedium = params.get('utm_medium') || undefined;
        hasAny = true;
    }
    return hasAny ? result : null;
};

export const resolveReferralViaProxy = async (
    _link: string
): Promise<{ affiliateToken?: string; affiliateTokenParam?: string; utmCampaign?: string; utmSource?: string; utmMedium?: string } | null> => {
    return null;
};

export const cleanupUrl = (origin: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    window.history.replaceState({}, document.title, url.pathname + url.hash);
    void origin;
};

export const handleOAuthCallback = async (
    url: string,
    _config: { clientId: string; redirectUri: string; scopes: string }
): Promise<{ access_token: string }> => {
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get('code') || '';
    const access_token = `stub_token_${code}`;
    localStorage.setItem('auth_info', JSON.stringify({ access_token }));
    return { access_token };
};
