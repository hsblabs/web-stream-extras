import { toU8Array } from "./uint8array";

export function toArrayBuffer(value: Uint8Array): ArrayBuffer;
export function toArrayBuffer(value: ArrayBufferLike): ArrayBuffer;
export function toArrayBuffer(
	value: Uint8Array | ArrayBufferLike,
): ArrayBuffer {
	if (value instanceof ArrayBuffer) {
		return value;
	}

	const view = value instanceof Uint8Array ? value : toU8Array(value);
	const { buffer, byteLength, byteOffset } = view;

	if (
		buffer instanceof ArrayBuffer &&
		byteOffset === 0 &&
		byteLength === buffer.byteLength
	) {
		return buffer;
	}

	const copy = toU8Array(byteLength);
	copy.set(view);
	return copy.buffer;
}
