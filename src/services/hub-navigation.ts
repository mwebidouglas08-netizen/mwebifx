import type { HubViewId } from '@/components/hub-sidebar';

type Listener = (view: HubViewId) => void;

const listeners = new Set<Listener>();

/**
 * Subscribe to programmatic hub navigation. The hub shell owns the active view
 * as component state, so services that should be able to switch views (the
 * voice agent) ask it through this bridge instead of reaching into React.
 */
export const subscribeHubNavigation = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** Request a view switch. Silently ignored while no shell is mounted. */
export const navigateToHubView = (view: HubViewId): void => {
    listeners.forEach(listener => listener(view));
};
