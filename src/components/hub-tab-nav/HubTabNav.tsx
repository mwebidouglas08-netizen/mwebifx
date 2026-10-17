import { useEffect, useRef } from 'react';
import { HUB_NAV_SECTIONS, HUB_VIEW_LABELS, type HubViewId } from '@/components/hub-sidebar';
import './hub-tab-nav.scss';

interface HubTabNavProps {
    activeView: HubViewId;
    onSelect: (view: HubViewId) => void;
}

/** Flattened tab list in section order — group gaps are rendered as dividers. */
const TAB_GROUPS: { caption: string; items: HubViewId[] }[] = HUB_NAV_SECTIONS.map(section => ({
    caption: section.caption,
    items: section.items.map(item => item.id),
}));

const HubTabNav = ({ activeView, onSelect }: HubTabNavProps) => {
    const listRef = useRef<HTMLDivElement>(null);

    // Keep the active tab in view on horizontal (mobile) strips.
    useEffect(() => {
        const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
        node?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }, [activeView]);

    return (
        <nav className='hub-tabnav' role='tablist' aria-label='Sections'>
            <div className='hub-tabnav__list' ref={listRef}>
                {TAB_GROUPS.map((group, gi) => (
                    <div className='hub-tabnav__group' key={group.caption} role='presentation'>
                        {gi > 0 && <span className='hub-tabnav__divider' aria-hidden='true' />}
                        {group.items.map(view => {
                            const active = activeView === view;
                            return (
                                <button
                                    key={view}
                                    type='button'
                                    role='tab'
                                    aria-selected={active}
                                    data-active={active}
                                    className={`hub-tabnav__item ${active ? 'hub-tabnav__item--active' : ''}`}
                                    onClick={() => onSelect(view)}
                                    title={HUB_VIEW_LABELS[view]}
                                >
                                    {HUB_VIEW_LABELS[view]}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>
        </nav>
    );
};

export default HubTabNav;
