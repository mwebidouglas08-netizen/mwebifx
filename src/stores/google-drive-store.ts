import { makeAutoObservable } from 'mobx';

export class GoogleDriveStore {
    is_google_drive_configured = false;
    is_authorised = false;

    constructor() {
        makeAutoObservable(this, undefined, { autoBind: true });
    }

    signIn() {
        // no-op stub
    }

    signOut() {
        // no-op stub
    }
}
