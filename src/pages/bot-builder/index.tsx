import React from 'react';
import { observer } from 'mobx-react-lite';

const BotBuilder = observer(() => {
    return <div className='bot-builder' data-testid='dt_bot_builder' />;
});

export default BotBuilder;
