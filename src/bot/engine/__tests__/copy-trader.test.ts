jest.mock('@/components/shared/utils/config/config', () => ({
    WS_SERVERS: {
        STAGING: 'wss://staging.example.com/options/ws/public',
        PRODUCTION: 'wss://example.com/options/ws/public',
    },
    isProduction: () => false,
}));

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    url: string;
    readyState = 0;
    sent: any[] = [];
    onopen: ((e?: any) => void) | null = null;
    onmessage: ((e?: any) => void) | null = null;
    onclose: ((e?: any) => void) | null = null;
    onerror: ((e?: any) => void) | null = null;

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
    }

    send(data: string) {
        try {
            this.sent.push(JSON.parse(data));
        } catch {
            this.sent.push(data);
        }
    }

    close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.onclose?.({});
    }

    /** Test hook: simulate the server accepting the connection. */
    open() {
        this.readyState = 1;
        this.onopen?.({});
    }

    /** Test hook: deliver a server frame. */
    emit(msg: any) {
        this.onmessage?.({ data: JSON.stringify(msg) });
    }

    static byToken(token: string): MockWebSocket[] {
        return MockWebSocket.instances.filter(w => w.url.includes(token));
    }
}

global.WebSocket = MockWebSocket as any;

import { copyTrading, CopyTradingState } from '../copy-trading';

const authorizeCopier = (token: string, auth: Record<string, unknown>): MockWebSocket => {
    copyTrading.addCopier(token, token.toUpperCase());
    const ws = MockWebSocket.byToken(token)[0];
    ws.open();
    ws.emit({ authorize: auth });
    return ws;
};

/** Drive a master contract through portfolio → proposal_open_contract. */
const pushMasterContract = (master: MockWebSocket, contractId: number, detail: Record<string, unknown>) => {
    master.emit({ portfolio: { portfolio_open: [{ contract_id: contractId }] } });
    master.emit({ proposal_open_contract: { contract_id: contractId, is_sold: 0, ...detail } });
};

describe('CopyTradingEngine', () => {
    beforeEach(() => {
        localStorage.clear();
        MockWebSocket.instances.length = 0;
        copyTrading.stop();
        copyTrading.setSettings({ replicationEnabled: true, stakeMultiplier: 1, stakeCap: null, allowRealCopiers: false });
        [...copyTrading.getState().copiers].forEach(c => copyTrading.removeCopier(c.id));
        MockWebSocket.instances.length = 0;
    });

    afterEach(() => {
        copyTrading.stop();
        [...copyTrading.getState().copiers].forEach(c => copyTrading.removeCopier(c.id));
        localStorage.clear();
        MockWebSocket.instances.length = 0;
    });

    it('validates a new copier against authorize before marking it authorized', () => {
        copyTrading.addCopier('demo-token-1', 'Alice');

        const initial = copyTrading.getState();
        expect(initial.copiers).toHaveLength(1);
        expect(initial.copiers[0].authorized).toBe(false);
        expect(initial.copiers[0].enabled).toBe(true);

        const ws = MockWebSocket.byToken('demo-token-1')[0];
        expect(ws).toBeDefined();
        ws.open();
        expect(ws.sent[0]).toEqual({ authorize: 1 });

        ws.emit({ authorize: { loginid: 'VRTC101', is_virtual: 1, currency: 'USD', balance: 500 } });

        const copier = copyTrading.getState().copiers[0];
        expect(copier.authorized).toBe(true);
        expect(copier.lastError).toBeNull();
        expect(copyTrading.getState().events.some(e => e.type === 'success')).toBe(true);
    });

    it('keeps a rejected token unauthorized with the error surfaced', () => {
        copyTrading.addCopier('bad-token', 'Broken');
        const ws = MockWebSocket.byToken('bad-token')[0];
        ws.open();
        ws.emit({ error: { code: 'InvalidToken', message: 'Invalid token' } });

        const copier = copyTrading.getState().copiers[0];
        expect(copier.authorized).toBe(false);
        expect(copier.lastError).toBe('Invalid token');
        expect(copyTrading.getState().events.some(e => e.type === 'error')).toBe(true);
    });

    it('blocks a non-demo copier at validation and never buys for it', async () => {
        authorizeCopier('real-token', { loginid: 'CR555', is_virtual: 0, currency: 'USD' });

        const copier = copyTrading.getState().copiers[0];
        expect(copier.authorized).toBe(false);
        expect(copier.lastError).toContain('non-demo copier blocked');

        await copyTrading.start('master-token');
        const master = MockWebSocket.byToken('master-token')[0];
        master.open();
        master.emit({ authorize: { loginid: 'CR1', balance: 100, is_virtual: 0, currency: 'USD' } });
        pushMasterContract(master, 501, {
            contract_type: 'DIGITOVER',
            barrier: '4',
            symbol: 'R_75',
            buy_price: 2,
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
        });

        const state = copyTrading.getState();
        expect(state.stats.observed).toBe(1);
        expect(state.stats.copied).toBe(0);
        expect(state.stats.skipped).toBe(1);
        expect(state.copiers[0].skipped).toBe(1);
        expect(state.events.some(e => e.message.includes('non-demo copier blocked'))).toBe(true);
        expect(MockWebSocket.byToken('real-token')).toHaveLength(1);
    });

    it('authorizes and replicates onto a REAL copier only when allowRealCopiers is enabled', async () => {
        copyTrading.setSettings({ allowRealCopiers: true });
        authorizeCopier('real-token', { loginid: 'CR555', is_virtual: 0, currency: 'USD' });

        const copier = copyTrading.getState().copiers[0];
        expect(copier.authorized).toBe(true);
        expect(copier.lastError).toBeNull();
        expect(
            copyTrading.getState().events.some(e => e.type === 'warn' && e.message.includes('REAL account'))
        ).toBe(true);

        await copyTrading.start('master-token');
        const master = MockWebSocket.byToken('master-token')[0];
        master.open();
        master.emit({ authorize: { loginid: 'CR1', balance: 100, is_virtual: 0, currency: 'USD' } });
        pushMasterContract(master, 601, {
            contract_type: 'DIGITOVER',
            barrier: '4',
            symbol: 'R_75',
            buy_price: 2,
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
        });

        const buyWs = MockWebSocket.byToken('real-token')[1];
        expect(buyWs).toBeDefined();
        buyWs.open();
        expect(buyWs.sent[0].amount).toBe(2);

        buyWs.emit({ proposal: { id: 'p-real', ask_price: 2, payout: 3.8 } });
        expect(buyWs.sent[1]).toEqual({ buy: 'p-real', price: 2 });
        buyWs.emit({ buy: { contract_id: 778, transaction_id: 10, buy_price: 2 } });
        await new Promise(r => setTimeout(r, 0));

        const state = copyTrading.getState();
        expect(state.stats.copied).toBe(1);
        expect(state.copiers[0].copied).toBe(1);
        expect(state.copiers[0].lastError).toBeNull();
    });

    it('re-authorizes a previously blocked real copier when allowRealCopiers is turned on', async () => {
        authorizeCopier('late-real', { loginid: 'CR777', is_virtual: 0, currency: 'USD' });
        expect(copyTrading.getState().copiers[0].authorized).toBe(false);
        expect(copyTrading.getState().copiers[0].lastError).toContain('non-demo copier blocked');

        copyTrading.setSettings({ allowRealCopiers: true });
        await new Promise(r => setTimeout(r, 0));

        const ws = MockWebSocket.byToken('late-real').slice(-1)[0];
        ws.open();
        ws.emit({ authorize: { loginid: 'CR777', is_virtual: 0, currency: 'USD' } });

        const copier = copyTrading.getState().copiers[0];
        expect(copier.authorized).toBe(true);
        expect(copier.lastError).toBeNull();
    });

    it('replicates a master trade with stake multiplier and cap', async () => {
        authorizeCopier('copier-token', { loginid: 'VRTC1', is_virtual: 1, currency: 'USD' });
        copyTrading.setSettings({ replicationEnabled: true, stakeMultiplier: 2, stakeCap: 5 });

        await copyTrading.start('master-token');
        const master = MockWebSocket.byToken('master-token')[0];
        expect(master.url).toContain('token=master-token');
        master.open();
        expect(master.sent[0]).toEqual({ authorize: 1 });

        master.emit({ authorize: { loginid: 'CR999', balance: 1000, is_virtual: 0, currency: 'USD' } });

        const running = copyTrading.getState();
        expect(running.status).toBe('running');
        expect(running.master).toEqual({ connected: true, loginid: 'CR999', balance: 1000, isVirtual: false });
        expect(master.sent).toContainEqual({ portfolio: 1, subscribe: 1 });

        pushMasterContract(master, 101, {
            contract_type: 'DIGITOVER',
            barrier: '4',
            symbol: 'R_75',
            buy_price: 3,
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
        });
        expect(master.sent).toContainEqual({ proposal_open_contract: 1, contract_id: 101, subscribe: 1 });
        expect(copyTrading.getState().stats.observed).toBe(1);

        const buyWs = MockWebSocket.byToken('copier-token').find(w => w !== MockWebSocket.byToken('copier-token')[0]);
        expect(buyWs).toBeDefined();
        expect(buyWs!.url).toContain('token=copier-token');
        buyWs!.open();

        const proposal = buyWs!.sent[0];
        expect(proposal.amount).toBe(5);
        expect(proposal.contract_type).toBe('DIGITOVER');
        expect(proposal.barrier).toBe('4');
        expect(proposal.symbol).toBe('R_75');
        expect(proposal.duration).toBe(1);
        expect(proposal.duration_unit).toBe('t');

        buyWs!.emit({ proposal: { id: 'p-1', ask_price: 5, payout: 9.5 } });
        expect(buyWs!.sent[1]).toEqual({ buy: 'p-1', price: 5 });
        buyWs!.emit({ buy: { contract_id: 777, transaction_id: 9, buy_price: 5 } });
        await new Promise(r => setTimeout(r, 0));

        const state = copyTrading.getState();
        expect(state.stats.copied).toBe(1);
        expect(state.copiers[0].copied).toBe(1);
        expect(state.copiers[0].lastError).toBeNull();
        expect(state.copiers[0].lastSeen).not.toBeNull();
        expect(state.events.some(e => e.type === 'purchase')).toBe(true);
    });

    it('observes but never buys while replication is disabled', async () => {
        authorizeCopier('copier-token', { loginid: 'VRTC1', is_virtual: 1, currency: 'USD' });
        copyTrading.setSettings({ replicationEnabled: false });

        await copyTrading.start('master-token');
        const master = MockWebSocket.byToken('master-token')[0];
        master.open();
        master.emit({ authorize: { loginid: 'CR999', balance: 1000, is_virtual: 0, currency: 'USD' } });
        pushMasterContract(master, 202, {
            contract_type: 'DIGITUNDER',
            barrier: '7',
            symbol: 'R_100',
            buy_price: 4,
            currency: 'USD',
            duration: 2,
            duration_unit: 't',
        });

        const state = copyTrading.getState();
        expect(state.stats.observed).toBe(1);
        expect(state.stats.copied).toBe(0);
        expect(state.stats.skipped).toBe(1);
        expect(state.events.some(e => e.message.includes('Replication is off'))).toBe(true);
        expect(MockWebSocket.byToken('copier-token')).toHaveLength(1);
    });

    it('counts a copier buy that fails at the quote stage', async () => {
        authorizeCopier('copier-token', { loginid: 'VRTC1', is_virtual: 1, currency: 'USD' });

        await copyTrading.start('master-token');
        const master = MockWebSocket.byToken('master-token')[0];
        master.open();
        master.emit({ authorize: { loginid: 'CR999', balance: 1000, is_virtual: 1, currency: 'USD' } });
        pushMasterContract(master, 303, {
            contract_type: 'DIGITOVER',
            barrier: '3',
            symbol: 'R_75',
            buy_price: 1,
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
        });

        const buyWs = MockWebSocket.byToken('copier-token')[1];
        expect(buyWs).toBeDefined();
        buyWs.open();
        buyWs.emit({ error: { code: 'RateLimit', message: 'Rate limit exceeded' } });

        const state = copyTrading.getState();
        expect(state.stats.failed).toBe(1);
        expect(state.copiers[0].failed).toBe(1);
        expect(state.copiers[0].lastError).toBe('Rate limit exceeded');
    });

    it('does not copy the same master contract twice', async () => {
        authorizeCopier('copier-token', { loginid: 'VRTC1', is_virtual: 1, currency: 'USD' });

        await copyTrading.start('master-token');
        const master = MockWebSocket.byToken('master-token')[0];
        master.open();
        master.emit({ authorize: { loginid: 'CR999', balance: 1000, is_virtual: 1, currency: 'USD' } });

        const fullContract = {
            contract_type: 'DIGITOVER',
            barrier: '4',
            symbol: 'R_75',
            buy_price: 2,
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
        };

        master.emit({ portfolio: { portfolio_open: [{ contract_id: 404 }] } });
        master.emit({ portfolio: { portfolio_open: [{ contract_id: 404 }] } });
        expect(copyTrading.getState().stats.observed).toBe(1);

        master.emit({ proposal_open_contract: { contract_id: 404, is_sold: 0, ...fullContract } });
        master.emit({ proposal_open_contract: { contract_id: 404, is_sold: 0, ...fullContract } });
        await new Promise(r => setTimeout(r, 0));

        // Only one buy socket beyond the auth-validation socket — the second
        // proposal_open_contract for #404 was deduplicated.
        const copierSockets = MockWebSocket.byToken('copier-token');
        expect(copierSockets).toHaveLength(2);
    });

    it('persists copiers and settings to localStorage and restores them', () => {
        copyTrading.addCopier('saved-token', 'Saved Copier');
        copyTrading.setSettings({ stakeMultiplier: 2.5, stakeCap: 10 });

        const raw = localStorage.getItem('mwx_copy_trading_v1');
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw as string);
        expect(parsed.copiers[0].label).toBe('Saved Copier');
        expect(parsed.copiers[0].enabled).toBe(true);
        expect(atob(parsed.copiers[0].token)).toBe('saved-token');
        expect(parsed.settings.stakeMultiplier).toBe(2.5);
        expect(parsed.settings.stakeCap).toBe(10);

        let restored: { copyTrading: { getState: () => CopyTradingState } } | undefined;
        jest.isolateModules(() => {
            restored = require('../copy-trading');
        });

        const state = restored!.copyTrading.getState();
        expect(state.copiers).toHaveLength(1);
        expect(state.copiers[0].label).toBe('Saved Copier');
        expect(state.copiers[0].authorized).toBe(false);
        expect(state.settings.stakeMultiplier).toBe(2.5);
        expect(state.settings.stakeCap).toBe(10);
    });

    it('toggles and removes copiers, persisting each change', () => {
        copyTrading.addCopier('tok-x', 'Copier X');
        const id = copyTrading.getState().copiers[0].id;

        copyTrading.toggleCopier(id, false);
        expect(copyTrading.getState().copiers[0].enabled).toBe(false);

        copyTrading.removeCopier(id);
        expect(copyTrading.getState().copiers).toHaveLength(0);
        const parsed = JSON.parse(localStorage.getItem('mwx_copy_trading_v1') as string);
        expect(parsed.copiers).toHaveLength(0);
    });

    it('stop() disconnects the master and settles back to idle', async () => {
        await copyTrading.start('master-token');
        const master = MockWebSocket.byToken('master-token')[0];
        master.open();
        master.emit({ authorize: { loginid: 'CR999', balance: 100, is_virtual: 1, currency: 'USD' } });
        expect(copyTrading.getState().status).toBe('running');

        copyTrading.stop();

        const state = copyTrading.getState();
        expect(state.status).toBe('idle');
        expect(state.master.connected).toBe(false);
        expect(state.events.some(e => e.message.includes('Copy trading stopped.'))).toBe(true);
    });

    it('rejects start without a master token', async () => {
        await copyTrading.start('   ');

        const state = copyTrading.getState();
        expect(state.status).toBe('error');
        expect(state.message).toContain('token');
    });
});
