const BYTE_LENGTH = "byteLength";

export function toU8Array(length: number): Uint8Array<ArrayBuffer>;
export function toU8Array(
	array: ArrayLike<number> | ArrayBufferLike,
): Uint8Array;
export function toU8Array(
	buffer: ArrayBufferLike,
	byteOffset?: number,
	length?: number,
): Uint8Array;
export function toU8Array(
	arg1: number | ArrayLike<number> | ArrayBufferLike,
	arg2?: number,
	arg3?: number,
): Uint8Array {
	return typeof arg1 === "number"
		? new Uint8Array(arg1)
		: BYTE_LENGTH in arg1
			? new Uint8Array(arg1, arg2, arg3)
			: new Uint8Array(arg1);
}

export function concatU8Arrays(...arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((sum, array) => sum + array.byteLength, 0);
	const result = toU8Array(totalLength);
	let offset = 0;

	for (const array of arrays) {
		result.set(array, offset);
		offset += array.byteLength;
	}

	return result;
}
