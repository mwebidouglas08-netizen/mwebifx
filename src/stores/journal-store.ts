import { makeAutoObservable } from 'mobx';

export class JournalStore {
    checked_filters: Record<string, boolean> = {};
    filters: any[] = [];
    filtered_messages: any[] = [];
    unfiltered_messages: any[] = [];
    is_filter_dialog_visible = false;

    constructor() {
        makeAutoObservable(this, undefined, { autoBind: true });
    }

    filterMessage(_checked: boolean, _item_id: number) {
        // no-op stub
    }

    toggleFilterDialog() {
        this.is_filter_dialog_visible = !this.is_filter_dialog_visible;
    }
}
