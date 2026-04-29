import { isInstance } from "./is";
import { toU8Array } from "./uint8array";

export function toArrayBuffer(value: Uint8Array): ArrayBuffer;
export function toArrayBuffer(value: ArrayBufferLike): ArrayBuffer;
export function toArrayBuffer(
	value: Uint8Array | ArrayBufferLike,
): ArrayBuffer {
	if (isInstance(value, ArrayBuffer)) {
		return value;
	}

	const view = isInstance(value, Uint8Array) ? value : toU8Array(value);
	const { buffer, byteLength, byteOffset } = view;

	if (
		isInstance(buffer, ArrayBuffer) &&
		byteOffset === 0 &&
		byteLength === buffer.byteLength
	) {
		return buffer;
	}

	const copy = toU8Array(byteLength);
	copy.set(view);
	return copy.buffer;
}
