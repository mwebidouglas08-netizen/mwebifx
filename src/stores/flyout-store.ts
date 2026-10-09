import { makeAutoObservable } from 'mobx';

export class FlyoutStore {
    flyout_content: Element[] = [];
    flyout_width = 260;
    is_help_content = false;
    is_search_flyout = false;
    is_visible = false;
    search_term = '';
    selected_category: Element | null = null;
    first_get_variable_block_index = -1;

    constructor() {
        makeAutoObservable(this);
    }

    initBlockWorkspace(_workspace_el: any, _block_node: any) {
        // no-op stub
    }

    onMount() {
        // no-op stub
    }

    onUnmount() {
        // no-op stub
    }
}
