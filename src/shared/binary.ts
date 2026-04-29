import { toU8Array } from "./uint8array";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function stringToBinary(value: string): Uint8Array {
	return textEncoder.encode(value);
}

export function binaryToString(value: AllowSharedBufferSource): string {
	return textDecoder.decode(value);
}

export function randomBytes(size: number): Uint8Array {
	return crypto.getRandomValues(toU8Array(size));
}
