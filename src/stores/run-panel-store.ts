import { makeAutoObservable } from 'mobx';

export class RunPanelStore {
    is_running = false;
    is_stop_button_visible = false;
    contract_stage = 0;
    is_clear_stat_disabled = true;
    active_index = 0;
    is_drawer_open = false;
    is_statistics_info_modal_open = false;

    constructor() {
        makeAutoObservable(this);
    }

    setIsRunning(value: boolean) {
        this.is_running = value;
    }

    onClearStatClick() {
        // no-op stub
    }

    onMount() {
        // no-op stub
    }

    onRunButtonClick() {
        // no-op stub
    }

    onUnmount() {
        // no-op stub
    }

    setActiveTabIndex(index: number) {
        this.active_index = index;
    }

    toggleDrawer(open: boolean) {
        this.is_drawer_open = open;
    }

    toggleStatisticsInfoModal() {
        this.is_statistics_info_modal_open = !this.is_statistics_info_modal_open;
    }
}
