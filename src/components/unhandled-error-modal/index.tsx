import React from 'react';
import { Localize } from '@deriv-com/translations';

type TUnhandledErrorModal = {
    onConfirm?: () => void;
};

const UnhandledErrorModal = ({ onConfirm }: TUnhandledErrorModal) => {
    return (
        <div className='unhandled-error-modal'>
            <div className='unhandled-error-modal__content'>
                <h2>
                    <Localize i18n_default_text='Something went wrong' />
                </h2>
                <p>
                    <Localize i18n_default_text='An unexpected error occurred. Please try again.' />
                </p>
                {onConfirm && (
                    <button onClick={onConfirm}>
                        <Localize i18n_default_text='OK' />
                    </button>
                )}
            </div>
        </div>
    );
};

export default UnhandledErrorModal;
