import { toReadableStream } from "./iterable";

export type TextInputChunk = string | Uint8Array;

export interface TextDecodeStreamOptions {
	encoding?: string;
	fatal?: boolean;
	ignoreBOM?: boolean;
}

export class TextDecodeStream extends TransformStream<TextInputChunk, string> {
	constructor(options: TextDecodeStreamOptions = {}) {
		const decoder = new TextDecoder(options.encoding ?? "utf-8", {
			fatal: options.fatal ?? false,
			ignoreBOM: options.ignoreBOM ?? false,
		});

		super({
			transform(chunk, controller) {
				if (typeof chunk === "string") {
					controller.enqueue(chunk);
					return;
				}

				const decoded = decoder.decode(chunk, { stream: true });

				if (decoded !== "") {
					controller.enqueue(decoded);
				}
			},

			flush(controller) {
				const decoded = decoder.decode();

				if (decoded !== "") {
					controller.enqueue(decoded);
				}
			},
		});
	}
}

export class TextEncodeStream extends TransformStream<string, Uint8Array> {
	constructor() {
		const encoder = new TextEncoder();

		super({
			transform(chunk, controller) {
				controller.enqueue(encoder.encode(chunk));
			},
		});
	}
}

export function decodeTextStream(
	input: ReadableStream<TextInputChunk>,
	options?: TextDecodeStreamOptions,
): ReadableStream<string> {
	return input.pipeThrough(new TextDecodeStream(options));
}

export function encodeTextStream(
	input: ReadableStream<string>,
): ReadableStream<Uint8Array>;
export function encodeTextStream(
	input: Iterable<string> | AsyncIterable<string>,
): ReadableStream<Uint8Array>;
export function encodeTextStream(
	input: ReadableStream<string> | Iterable<string> | AsyncIterable<string>,
): ReadableStream<Uint8Array> {
	return toReadableStream(input).pipeThrough(new TextEncodeStream());
}
