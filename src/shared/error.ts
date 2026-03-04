export function throwError(
	message?: string | undefined,
	options?: ErrorOptions | undefined,
): never {
	throw new Error(message, options);
}
