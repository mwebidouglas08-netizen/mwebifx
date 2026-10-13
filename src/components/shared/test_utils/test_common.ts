import { JSDOM } from 'jsdom';
import { reset } from '../utils/url/url';

const jsdom = new JSDOM();

const setURL = (url: string) => {
    jsdom.reconfigure({ url });
    // eslint-disable-next-line no-unused-expressions
    jsdom.window.location.href = url;
    reset();
};

module.exports = {
    expect,
    setURL,
    getApiToken: () => process.env.DERIV_TEST_API_TOKEN || '',
};
