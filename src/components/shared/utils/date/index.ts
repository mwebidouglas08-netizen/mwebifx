import moment from 'moment';

export const toMoment = (input?: any) => {
    if (moment.isMoment(input)) return input;
    return moment(input);
};
