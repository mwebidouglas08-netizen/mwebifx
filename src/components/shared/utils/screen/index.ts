export const getScreenWidth = (): number => window.innerWidth;

export const getScreenHeight = (): number => window.innerHeight;

export const isMobileWidth = (breakpoint = 768): boolean => window.innerWidth < breakpoint;

export const isTabletWidth = (breakpoint = 1024): boolean => window.innerWidth < breakpoint;

export const isDesktopWidth = (breakpoint = 1024): boolean => window.innerWidth >= breakpoint;
