import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useCurrencyConversion } from '@/hooks/use-app-preferences';
import { getConvertedBalance } from '@/utils/currency-conversion';
import { isDemoAccount } from '@/utils/account-helpers';
import './account-switcher.scss';

type TAccount = { loginid: string; currency?: string; balance?: number | string; is_virtual?: number };

/**
 * Demo / Real account switcher for the AI Hub header.
 *
 * The app already has a switcher in the bot-dashboard header
 * (components/layout/header/account-switcher.tsx), but it is only rendered for
 * logged-in users with more than one account, and the hub is the default view —
 * so there was no way to reach demo/real switching from the page users actually
 * land on. This control mirrors the same store contract: pick an account, write
 * `active_loginid`, then let `client.checkAndRegenerateWebSocket()` rebuild the
 * OTP-authenticated socket for that account.
 */
const HubAccountSwitcher = observer(() => {
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { client, run_panel } = useStore() ?? {};
    const { displayCurrency, toggle: toggleCurrency } = useCurrencyConversion();

    const is_logged_in = Boolean(client?.is_logged_in);
    const activeLoginid = client?.loginid || '';
    const is_bot_running = Boolean(run_panel?.is_stop_button_visible);

    const accounts: TAccount[] = useMemo(() => {
        const fromAccounts = Object.values(client?.accounts ?? {}) as TAccount[];
        if (fromAccounts.length) return fromAccounts;
        return Array.isArray(client?.account_list) ? (client.account_list as TAccount[]) : [];
    }, [client?.accounts, client?.account_list]);

    const formatted = useMemo(() => {
        const list = accounts.filter(a => a?.loginid);
        if (!list.length && activeLoginid) {
            list.push({ loginid: activeLoginid, currency: client?.currency, balance: client?.balance });
        }
        return list
            .map(a => ({
                loginid: a.loginid,
                currency: a.currency || '',
                balance: Number(a.balance ?? 0),
                isVirtual: isDemoAccount(a.loginid),
                isActive: a.loginid === activeLoginid,
            }))
            .sort((a, b) => Number(b.isActive) - Number(a.isActive));
    }, [accounts, activeLoginid, client?.currency, client?.balance]);

    useEffect(() => {
        if (!isOpen) return;
        const onDown = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [isOpen]);

    const selectAccount = useCallback(
        (loginid: string) => {
            if (loginid === activeLoginid) return;
            if (is_bot_running) return;
            localStorage.setItem('active_loginid', loginid);
            client?.checkAndRegenerateWebSocket?.();
            setIsOpen(false);
        },
        [activeLoginid, client, is_bot_running]
    );

    // KSH ⇄ USD view of the same equity.
    const activeConv = getConvertedBalance(
        Number(client?.balance ?? 0),
        client?.currency || 'USD',
        displayCurrency
    );

    if (!is_logged_in) {
        return (
            <div className='hub-account' ref={wrapperRef}>
                <button
                    type='button'
                    className='hub-account__trigger hub-account__trigger--login'
                    onClick={() => run_panel?.showLoginDialog?.()}
                >
                    Log in to trade
                </button>
            </div>
        );
    }

    const isVirtual = isDemoAccount(activeLoginid);
    const canSwitch = formatted.length > 1 && !is_bot_running;

    return (
        <div className='hub-account' ref={wrapperRef}>
            <button
                type='button'
                className={`hub-account__trigger ${isVirtual ? 'hub-account__trigger--demo' : ''}`}
                aria-haspopup={canSwitch ? 'listbox' : undefined}
                aria-expanded={canSwitch ? isOpen : undefined}
                onClick={() => canSwitch && setIsOpen(v => !v)}
            >
                <span className='hub-account__badge'>{isVirtual ? 'Demo' : 'Real'}</span>
                <span className='hub-account__meta'>
                    {activeLoginid}
                    <span className='hub-account__balance' data-testid='dt_hub_balance'>
                        {activeConv.formatted}
                        {activeConv.secondary && (
                            <span className='hub-account__balance-alt'>≈ {activeConv.secondary}</span>
                        )}
                    </span>
                </span>
                {canSwitch && (
                    <svg className={`hub-account__chevron ${isOpen ? 'is-open' : ''}`} width='12' height='12' viewBox='0 0 12 12' fill='none'>
                        <path d='M2 4L6 8L10 4' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
                    </svg>
                )}
            </button>

            {isOpen && canSwitch && (
                <div className='hub-account__menu' role='listbox' aria-label='Switch account'>
                    {formatted.map(a => (
                        <button
                            key={a.loginid}
                            type='button'
                            role='option'
                            aria-selected={a.isActive}
                            className={`hub-account__option ${a.isActive ? 'is-active' : ''}`}
                            onClick={() => selectAccount(a.loginid)}
                        >
                            <span className={`hub-account__badge ${a.isVirtual ? 'hub-account__badge--demo' : ''}`}>
                                {a.isVirtual ? 'Demo' : 'Real'}
                            </span>
                            <span className='hub-account__option-id'>{a.loginid}</span>
                            <span className='hub-account__option-balance'>
                                {getConvertedBalance(a.balance, a.currency || 'USD', displayCurrency).formatted}
                            </span>
                        </button>
                    ))}
                </div>
            )}

            <button
                type='button'
                data-testid='dt_hub_currency_toggle'
                className='hub-account__currency'
                aria-label={
                    displayCurrency === 'USD'
                        ? 'Show equity in Kenyan Shillings'
                        : 'Show equity in US Dollars'
                }
                title={displayCurrency === 'USD' ? 'Switch to KSH' : 'Switch to USD'}
                onClick={toggleCurrency}
            >
                {displayCurrency === 'USD' ? 'KSH' : 'USD'}
            </button>
        </div>
    );
});

export default HubAccountSwitcher;
