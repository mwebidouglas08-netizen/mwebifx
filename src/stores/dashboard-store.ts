import { makeAutoObservable } from 'mobx';

export class DashboardStore {
    is_web_socket_intialised = false;
    active_tab: string | number = 'dashboard';
    active_tour = '';

    constructor() {
        makeAutoObservable(this, undefined, { autoBind: true });
    }

    setIsWebSocketInitialised(value: boolean) {
        this.is_web_socket_intialised = value;
    }

    setActiveTab(tab: string | number) {
        this.active_tab = tab;
    }

    setActiveTour(tour: string) {
        this.active_tour = tour;
    }

    setPreviewOnPopup(_preview: boolean) {
        // no-op stub
    }

    setOpenSettings(_type: string) {
        // no-op stub
    }

    onZoomInOutClick(_zoom_in: boolean) {
        // no-op stub
    }
}
