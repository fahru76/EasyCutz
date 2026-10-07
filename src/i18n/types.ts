/** Same shape as the English dictionary, with every leaf widened to string. */
export type Dict<T> = { readonly [K in keyof T]: T[K] extends string ? string : Dict<T[K]> };
