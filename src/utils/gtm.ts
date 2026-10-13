// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import { reaction } from 'mobx';
import { TStatistics } from '@/components/transaction-details/transaction-details.types';
import RootStore from '@/stores/root-store';
import { ProposalOpenContract } from '@deriv/api-types';

const GTM = (() => {
    let timeoutId: NodeJS.Timeout;
    let initialized = false;
    const pushDataLayer = (data: { [key: string]: string | number | boolean; event: string }): void => {
        window.dataLayer?.push(data);
    };

    const init = (_root_store: RootStore): void => {
        if (initialized) return;
        initialized = true;

        // Third-party ad/analytics trackers (GTM container -> match2one/taboola/
        // doubleclick) are intentionally NOT loaded. They are unrelated to
        // trading, add tracking surface, and generate CSP/console noise. The
        // dataLayer API below is kept as a safe no-op so existing call sites
        // (run-panel, flyout, toolbox) keep working without the external script.

        try {
            const { run_panel, transactions, client, common } = _root_store;
            reaction(
                () => run_panel.is_running,
                (() => {
                    return () => {
                        if (run_panel.is_running) {
                            clearTimeout(timeoutId);
                            timeoutId = setTimeout(() => {
                                onRunBot(client?.loginid, common?.server_time?.unix(), transactions?.statistics);
                            }, 500);
                        }
                    };
                })()
            );
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn('Error initializing GTM reactions ', error);
        }
    };

    const onRunBot = (login_id: string, server_time: number, statistics: TStatistics): void => {
        try {
            const run_id = `${login_id}-${server_time}`;
            const counters = `tr:${statistics.number_of_runs},\
                ts:${statistics.total_stake},\
                py:${statistics.total_payout},\
                lc:${statistics.lost_contracts},\
                wc:${statistics.won_contracts},\
                pr:${statistics.total_profit}`;

            const data = {
                counters: counters.replace(/\s/g, ''),
                event: 'dbot_run',
                run_id,
            };
            pushDataLayer(data);
        } catch (error) {
            console.warn('Error pushing run data to datalayer ', error); // eslint-disable-line no-console
        }
    };

    const onTransactionClosed = (contract: ProposalOpenContract): void => {
        const data = {
            event: 'dbot_run_transaction',
            reference_id: contract?.contract_id ?? '',
        };
        pushDataLayer(data);
    };

    return {
        init,
        pushDataLayer,
        onTransactionClosed,
        onRunBot,
    };
})();

export default GTM;
