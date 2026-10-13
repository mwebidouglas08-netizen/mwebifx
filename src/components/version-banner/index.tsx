import { useEffect, useState } from 'react';
import './version-banner.scss';

const localBuild = (): string => {
    const src = document.querySelector('script[src*="/static/js/index."]')?.getAttribute('src') || '';
    return (/index\.([a-f0-9]+)\.js/.exec(src) || [])[1] || '';
};

const VersionBanner = () => {
    const [remote, setRemote] = useState('');

    useEffect(() => {
        let alive = true;
        const check = async () => {
            try {
                const res = await fetch(`/index.html?__v=${Date.now()}`, { cache: 'no-store' });
                if (!res.ok) return;
                const html = await res.text();
                const m = /static\/js\/index\.([a-f0-9]+)\.js/.exec(html);
                const local = localBuild();
                if (!alive || !m || !local) return;
                setRemote(m[1] === local ? '' : m[1]);
            } catch {
                /* offline or transient failure — keep current state */
            }
        };
        check();
        const onFocus = () => check();
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        window.addEventListener('online', onFocus);
        const timer = window.setInterval(check, 30000);
        return () => {
            alive = false;
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
            window.removeEventListener('online', onFocus);
            window.clearInterval(timer);
        };
    }, []);

    if (!remote) return null;
    const local = localBuild();
    return (
        <div className='version-banner' role='alert'>
            <span>
                A newer version of the app is live (build {remote.slice(0, 8)} — you are running
                {' '}{local.slice(0, 8)}). Reload to update.
            </span>
            <button type='button' className='version-banner__btn' onClick={() => window.location.reload()}>
                Reload now
            </button>
        </div>
    );
};

export default VersionBanner;
