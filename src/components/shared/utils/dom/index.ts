export const getElementsByClassName = (className: string): HTMLElement[] =>
    Array.from(document.getElementsByClassName(className) as HTMLCollectionOf<HTMLElement>);

export const getElementById = (id: string): HTMLElement | null => document.getElementById(id);

export const querySelector = (selector: string): Element | null => document.querySelector(selector);

export const querySelectorAll = (selector: string): NodeListOf<Element> => document.querySelectorAll(selector);
