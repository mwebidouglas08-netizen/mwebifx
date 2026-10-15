import type { ReactNode } from 'react';
import './hub-page.scss';

type HubPageProps = {
    children: ReactNode;
    className?: string;
};

/** Standard page container: centred column, generous padding and vertical rhythm. */
export const HubPage = ({ children, className }: HubPageProps) => (
    <div className={['hub-page', className].filter(Boolean).join(' ')}>
        <div className='hub-page__body'>{children}</div>
    </div>
);

type HubPageHeaderProps = {
    title: string;
    subtitle?: ReactNode;
    /** Account / status pill (or a fragment of pills) shown on the right. */
    badge?: ReactNode;
    /** Right-hand action slot (search, toolbar, controls…). */
    actions?: ReactNode;
};

export const HubPageHeader = ({ title, subtitle, badge, actions }: HubPageHeaderProps) => (
    <header className='hub-header'>
        <div className='hub-header__text'>
            <h2 className='hub-header__title'>{title}</h2>
            {subtitle ? <p className='hub-header__subtitle'>{subtitle}</p> : null}
        </div>
        {badge || actions ? (
            <div className='hub-header__aside'>
                {badge ? <div className='hub-header__badge'>{badge}</div> : null}
                {actions ? <div className='hub-header__actions'>{actions}</div> : null}
            </div>
        ) : null}
    </header>
);

type HubNoteTone = 'info' | 'risk';

type HubNoteProps = {
    tone: HubNoteTone;
    children: ReactNode;
    role?: 'note' | 'alert' | 'status';
};

/** Honesty / risk banner: info = cyan-tinted note, risk = amber-tinted warning. */
export const HubNote = ({ tone, children, role = 'note' }: HubNoteProps) => (
    <div className={`hub-note hub-note--${tone}`} role={role}>
        <span className='hub-note__dot' aria-hidden='true' />
        <div className='hub-note__body'>{children}</div>
    </div>
);

export default HubPage;
