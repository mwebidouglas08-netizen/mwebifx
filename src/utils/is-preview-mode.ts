export const PREVIEW_BASE_PATH = '/bot/preview';

export const isPreviewMode = (): boolean => process.env.NEXT_PUBLIC_APP_BUILD === 'true';
