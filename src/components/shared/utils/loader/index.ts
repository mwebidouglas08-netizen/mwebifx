export const showLoader = () => {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'flex';
};

export const hideLoader = () => {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
};

export const isLoaderVisible = () => {
    const loader = document.getElementById('loader');
    return loader?.style.display === 'flex';
};
