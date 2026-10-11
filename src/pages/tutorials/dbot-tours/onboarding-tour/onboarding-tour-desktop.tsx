// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { isPreviewMode } from '@/utils/is-preview-mode';
import { getSetting } from '@/utils/settings';
import ReactJoyrideWrapper from '../common/react-joyride-wrapper';
import TourStartDialog from '../common/tour-start-dialog';
import { DBOT_ONBOARDING } from '../tour-content';
import { useTourHandler } from '../useTourHandler';

const OnboardingTourDesktop = observer(() => {
    const { dashboard, ui } = useStore();
    const { active_tab, active_tour, setActiveTour, setTourDialogVisibility, is_tour_dialog_visible } = dashboard;
    const { is_close_tour, is_finished, handleJoyrideCallback, setIsCloseTour } = useTourHandler();
    // The dashboard stays mounted behind the AI Hub so the bot engine is live.
    // The tour is dashboard chrome, so it must not fire while the hub is shown —
    // its overlay dims the page and blocks every click behind it.
    const is_hub_active = ui?.active_hub_view === 'ai-hub';
    React.useEffect(() => {
        if (is_close_tour || is_finished) {
            setIsCloseTour(false);
            setActiveTour('');
        }
    }, [is_close_tour, is_finished, setActiveTour, setIsCloseTour]);

    // Check if tour should be shown with setTimeout to prevent showing on every reload
    React.useEffect(() => {
        // Onboarding tours are noise inside the App Builder preview — skip them.
        if (isPreviewMode()) return;
        if (active_tab === 0) {
            const timeoutId = setTimeout(() => {
                const token = getSetting('onboard_tour_token');
                if (!token && !is_tour_dialog_visible) {
                    setTourDialogVisibility(true);
                }
            }, 100);

            return () => clearTimeout(timeoutId);
        }
    }, [active_tab, is_tour_dialog_visible, is_hub_active, setTourDialogVisibility]);

    // Dismiss anything already open the moment the hub takes over.
    React.useEffect(() => {
        if (!is_hub_active) return;
        setTourDialogVisibility(false);
        setActiveTour('');
    }, [is_hub_active, setTourDialogVisibility, setActiveTour]);

    return (
        <>
            {!is_hub_active && <TourStartDialog />}
            {active_tour && !is_hub_active && (
                <ReactJoyrideWrapper
                    handleCallback={handleJoyrideCallback}
                    steps={DBOT_ONBOARDING}
                    spotlightClicks
                    disableCloseOnEsc
                    disableOverlay={false}
                    disableOverlayClose={true}
                />
            )}
        </>
    );
});

export default OnboardingTourDesktop;
