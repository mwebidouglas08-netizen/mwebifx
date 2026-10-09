import { makeAutoObservable } from 'mobx';

export class LoadModalStore {
    active_index = 0;
    is_load_modal_open = false;
    loaded_local_file: File | null = null;
    recent_strategies: any[] = [];
    tab_name = 'local';
    is_explanation_expand = false;
    is_open_button_loading = false;
    is_open_button_disabled = false;
    imported_strategy_type = 'pending';
    selected_strategy_id: string | number | null = null;

    constructor() {
        makeAutoObservable(this);
    }

    setActiveTabIndex(index: number) {
        this.active_index = index;
    }

    toggleLoadModal() {
        this.is_load_modal_open = !this.is_load_modal_open;
    }

    onEntered() {
        // no-op stub
    }

    toggleExplanationExpand() {
        this.is_explanation_expand = !this.is_explanation_expand;
    }

    loadStrategyOnBotBuilder() {
        // no-op stub
    }

    setLoadedLocalFile(file: File | null) {
        this.loaded_local_file = file;
    }

    saveStrategyToLocalStorage() {
        // no-op stub
    }

    handleFileChange(_event: any, _is_type_check_only?: boolean): boolean {
        return false;
    }

    getSaveType(_save_type: string): string {
        return '';
    }

    loadStrategyOnModalRecentPreview(_id: string | number) {
        // no-op stub
    }

    updateXmlValuesOnStrategySelection() {
        // no-op stub
    }

    onDriveOpen() {
        // no-op stub
    }
}
