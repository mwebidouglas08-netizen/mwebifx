export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type Maybe<T> = T | null | undefined;
export type Dict<T = unknown> = Record<string, T>;
export type AsyncFunction<T = void> = () => Promise<T>;
