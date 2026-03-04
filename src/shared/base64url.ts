import { throwError } from "./error";
import { toU8Array } from "./uint8array";

export function encodeBase64Url(bytes: Uint8Array): string {
	let binary = "";

	for (const value of bytes) {
		binary += String.fromCharCode(value);
	}

	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/u, "");
}

export function decodeBase64Url(value: string): Uint8Array {
	const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

	let binary: string;

	try {
		binary = atob(padded);
	} catch {
		throwError("Encrypted stream key is not valid base64url");
	}

	const bytes = toU8Array(binary.length);

	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return bytes;
}
