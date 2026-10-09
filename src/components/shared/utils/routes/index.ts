export const getRoute = (path: string): string => path.replace(/^\/+|\/+$/g, '');

export const joinPaths = (...paths: string[]): string =>
    paths.map(p => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');

export const isActiveRoute = (currentPath: string, targetPath: string): boolean =>
    currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);

export const getQueryParams = (search: string): URLSearchParams => new URLSearchParams(search);
