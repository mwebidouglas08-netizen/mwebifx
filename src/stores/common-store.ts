import { makeAutoObservable } from 'mobx';

export class CommonStore {
    error: { header?: string; message?: string; redirect_label?: string; redirectOnClick?: () => void; should_clear_error_on_click?: boolean; redirect_to?: string; should_redirect?: boolean } | null = null;
    current_language = 'EN';
    server_time: any = null;
    socket_opened = false;

    constructor() {
        makeAutoObservable(this);
    }

    setError(error: any) {
        this.error = error;
    }

    setCurrentLanguage(lang: string) {
        this.current_language = lang;
    }

    setServerTime(time: any, is_local: boolean) {
        this.server_time = time;
    }

    setSocketOpened(opened: boolean) {
        this.socket_opened = opened;
    }
}
