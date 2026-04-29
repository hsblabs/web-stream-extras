import { toReadableStream } from "../shared/readable";

export type Base64Variant = "base64" | "base64url";
export type Base64InputChunk = string | Uint8Array;

export interface Base64EncodeStreamOptions {
	variant?: Base64Variant;
	padding?: boolean;
}

export interface Base64DecodeStreamOptions {
	variant?: Base64Variant;
}

export class Base64EncodeStream extends TransformStream<Uint8Array, string> {
	constructor(options: Base64EncodeStreamOptions = {}) {
		const variant = options.variant ?? "base64";
		const padding = options.padding ?? variant === "base64";

		let pending = new Uint8Array();

		super({
			transform(chunk, controller) {
				const input =
					pending.length === 0 ? chunk : concatBytes(pending, chunk);
				const encodeLength = input.length - (input.length % 3);

				if (encodeLength > 0) {
					controller.enqueue(
						formatBase64(encodeBase64Bytes(input.subarray(0, encodeLength)), {
							variant,
							padding,
						}),
					);
				}

				pending = input.slice(encodeLength);
			},

			flush(controller) {
				if (pending.length > 0) {
					controller.enqueue(
						formatBase64(encodeBase64Bytes(pending), { variant, padding }),
					);
				}
			},
		});
	}
}

export class Base64DecodeStream extends TransformStream<
	Base64InputChunk,
	Uint8Array
> {
	constructor(options: Base64DecodeStreamOptions = {}) {
		const variant = options.variant ?? "base64";
		const decoder = new TextDecoder();

		let buffer = "";
		let finished = false;

		const decodeTextChunk = (chunk: Base64InputChunk): string => {
			if (typeof chunk === "string") {
				return chunk;
			}

			return decoder.decode(chunk, { stream: true });
		};

		super({
			transform(chunk, controller) {
				const value = stripWhitespace(decodeTextChunk(chunk));

				if (value === "") {
					return;
				}
				if (finished) {
					throw new SyntaxError("Base64 input has data after padding");
				}

				assertBase64Chars(value, variant);
				buffer += value;
				assertPaddingPlacement(buffer);

				while (buffer.length >= 4) {
					const group = buffer.slice(0, 4);

					if (group.includes("=")) {
						controller.enqueue(decodeBase64Group(group, variant));
						buffer = buffer.slice(4);
						if (buffer !== "") {
							throw new SyntaxError("Base64 input has data after padding");
						}
						finished = true;
						return;
					}

					controller.enqueue(decodeBase64Group(group, variant));
					buffer = buffer.slice(4);
				}
			},

			flush(controller) {
				const value = stripWhitespace(decoder.decode());
				if (value !== "") {
					if (finished) {
						throw new SyntaxError("Base64 input has data after padding");
					}
					assertBase64Chars(value, variant);
					buffer += value;
					assertPaddingPlacement(buffer);
				}

				if (buffer === "") {
					return;
				}
				if (buffer.length === 1) {
					throw new SyntaxError("Base64 input has an incomplete final group");
				}

				controller.enqueue(decodeBase64Group(padBase64(buffer), variant));
			},
		});
	}
}

export function encodeBase64Stream(
	input: ReadableStream<Uint8Array>,
	options?: Omit<Base64EncodeStreamOptions, "variant">,
): ReadableStream<string>;
export function encodeBase64Stream(
	input: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
	options?: Omit<Base64EncodeStreamOptions, "variant">,
): ReadableStream<string>;
export function encodeBase64Stream(
	input:
		| ReadableStream<Uint8Array>
		| Iterable<Uint8Array>
		| AsyncIterable<Uint8Array>,
	options: Omit<Base64EncodeStreamOptions, "variant"> = {},
): ReadableStream<string> {
	return toReadableStream(input).pipeThrough(
		new Base64EncodeStream({ ...options, variant: "base64" }),
	);
}

export function encodeBase64UrlStream(
	input: ReadableStream<Uint8Array>,
	options?: Omit<Base64EncodeStreamOptions, "variant">,
): ReadableStream<string>;
export function encodeBase64UrlStream(
	input: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
	options?: Omit<Base64EncodeStreamOptions, "variant">,
): ReadableStream<string>;
export function encodeBase64UrlStream(
	input:
		| ReadableStream<Uint8Array>
		| Iterable<Uint8Array>
		| AsyncIterable<Uint8Array>,
	options: Omit<Base64EncodeStreamOptions, "variant"> = {},
): ReadableStream<string> {
	return toReadableStream(input).pipeThrough(
		new Base64EncodeStream({
			padding: false,
			...options,
			variant: "base64url",
		}),
	);
}

export function decodeBase64Stream(
	input: ReadableStream<Base64InputChunk>,
	options?: Omit<Base64DecodeStreamOptions, "variant">,
): ReadableStream<Uint8Array> {
	return input.pipeThrough(
		new Base64DecodeStream({ ...options, variant: "base64" }),
	);
}

export function decodeBase64UrlStream(
	input: ReadableStream<Base64InputChunk>,
	options?: Omit<Base64DecodeStreamOptions, "variant">,
): ReadableStream<Uint8Array> {
	return input.pipeThrough(
		new Base64DecodeStream({ ...options, variant: "base64url" }),
	);
}

function encodeBase64Bytes(bytes: Uint8Array): string {
	let binary = "";

	for (const value of bytes) {
		binary += String.fromCharCode(value);
	}

	return btoa(binary);
}

function decodeBase64Group(value: string, variant: Base64Variant): Uint8Array {
	const base64 = variant === "base64url" ? toBase64(value) : value;
	let binary: string;

	try {
		binary = atob(base64);
	} catch (cause) {
		throw new SyntaxError("Base64 input is not valid", { cause });
	}

	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return bytes;
}

function formatBase64(
	value: string,
	options: { variant: Base64Variant; padding: boolean },
): string {
	const encoded =
		options.variant === "base64url"
			? value.replaceAll("+", "-").replaceAll("/", "_")
			: value;

	return options.padding ? encoded : encoded.replace(/=+$/u, "");
}

function padBase64(value: string): string {
	if (value.includes("=")) {
		if (value.length % 4 !== 0) {
			throw new SyntaxError("Base64 padding is not aligned to a 4-char group");
		}
		return value;
	}

	return value.padEnd(Math.ceil(value.length / 4) * 4, "=");
}

function toBase64(value: string): string {
	return value.replaceAll("-", "+").replaceAll("_", "/");
}

function stripWhitespace(value: string): string {
	return value.replace(/[\t\n\f\r ]/gu, "");
}

function assertBase64Chars(value: string, variant: Base64Variant): void {
	const valid =
		variant === "base64"
			? /^[A-Za-z0-9+/=]*$/u.test(value)
			: /^[A-Za-z0-9_\-=]*$/u.test(value);

	if (!valid) {
		throw new SyntaxError("Base64 input contains invalid characters");
	}
}

function assertPaddingPlacement(value: string): void {
	const firstPadding = value.indexOf("=");

	if (firstPadding === -1) {
		return;
	}
	if (/[^=]/u.test(value.slice(firstPadding))) {
		throw new SyntaxError("Base64 input has data after padding");
	}
	if (value.length - firstPadding > 2) {
		throw new SyntaxError("Base64 input has too much padding");
	}
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
	const output = new Uint8Array(left.length + right.length);
	output.set(left, 0);
	output.set(right, left.length);
	return output;
}
