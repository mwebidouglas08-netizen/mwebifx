export const downloadFile = (data: any, filename: string, type: string) => {
    const blob = new Blob([data], { type: `${type}/csv` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

export const getSuccessJournalMessage = (_message: string, _extra?: Record<string, any>): string => {
    return _message;
};
