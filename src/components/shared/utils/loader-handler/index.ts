export const handleLoader = (isLoading: boolean) => {
    if (isLoading) {
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'flex';
    } else {
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'none';
    }
};

export const withLoader = async <T>(fn: () => Promise<T>): Promise<T> => {
    handleLoader(true);
    try {
        return await fn();
    } finally {
        handleLoader(false);
    }
};
