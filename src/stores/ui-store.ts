import { makeAutoObservable } from 'mobx';

export class UiStore {
    show_prompt = false;
    is_dark_mode_on = false;
    device: 'mobile' | 'tablet' | 'desktop' = 'desktop';

    constructor() {
        // autoBind ensures actions stay bound when destructured (e.g. `const { setDevice } = ui`)
        makeAutoObservable(this, undefined, { autoBind: true });
    }

    setShowPrompt(value: boolean) {
        this.show_prompt = value;
    }

    setIsDarkModeOn(value: boolean) {
        this.is_dark_mode_on = value;
    }

    setDevice(device: 'mobile' | 'tablet' | 'desktop') {
        this.device = device;
    }
}
