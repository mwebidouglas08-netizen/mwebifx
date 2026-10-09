import { makeAutoObservable } from 'mobx';

export class FlyoutHelpStore {
    active_helper = '';
    block_node: Element | null = null;
    block_type = '';
    examples: any[] = [];
    help_string: { text: string[] } = { text: [] };
    should_next_disable = true;
    should_previous_disable = true;
    title = '';

    constructor() {
        makeAutoObservable(this);
    }

    initFlyoutHelp(_node: Element, _block_type: string) {
        // no-op stub
    }

    setHelpContent(_node: Element) {
        // no-op stub
    }

    onBackClick() {
        // no-op stub
    }

    onSequenceClick(_is_next: boolean) {
        // no-op stub
    }
}
