import { useEffect, useRef, useState } from 'react';
import { HubSession, HubSessionOptions, HubSessionSnapshot } from './engine/hub-session';

export interface HubSessionHandle {
    session: HubSession;
    snap: HubSessionSnapshot;
}

/**
 * Keeps one HubSession alive across renders. The evaluate callback should read
 * the latest config through refs; push config changes with session.updateOptions.
 */
export const useHubSession = (createOptions: () => HubSessionOptions): HubSessionHandle => {
    const sessionRef = useRef<HubSession | null>(null);
    if (!sessionRef.current) {
        sessionRef.current = new HubSession(createOptions());
    }
    const [snap, setSnap] = useState<HubSessionSnapshot>(() => sessionRef.current!.getSnapshot());

    useEffect(() => {
        const session = sessionRef.current!;
        const updater = (s: HubSessionSnapshot) => setSnap({ ...s, rows: [...s.rows], journal: [...s.journal] });
        updater(session.getSnapshot());
        session.onSnapshot = updater;
        return () => {
            session.onSnapshot = undefined;
            session.dispose();
            sessionRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { session: sessionRef.current, snap };
};
