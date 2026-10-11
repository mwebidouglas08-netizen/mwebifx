import { makeAutoObservable } from 'mobx';
import moment from 'moment';

export class CommonStore {
    error: { header?: string; message?: string; redirect_label?: string; redirectOnClick?: () => void; should_clear_error_on_click?: boolean; redirect_to?: string; should_redirect?: boolean } | null = null;
    current_language = 'EN';
    // Must be a moment from the start: footer/ServerTime.tsx calls
    // common.server_time.format(...) and the desktop Footer can render
    // before ServerTime.init() has run (which would otherwise leave null).
    server_time: any = moment();
    socket_opened = false;

    constructor() {
        makeAutoObservable(this, undefined, { autoBind: true });
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
