
// biome-ignore lint/suspicious/noExplicitAny: constructor_ can be any error constructor
export function isInstance<T>(value: unknown, constructor_: new (...args: any[]) => T): value is T {
    return value instanceof constructor_;
}

export function isError<E extends Error>(value: unknown, constructor_?: ErrorConstructor): value is E {
    return isInstance(value, constructor_ ?? Error);
}
