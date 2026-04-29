import { isInstance } from "../shared/is";

export interface JSONLStringifyStreamOptions {
	replacer?: Parameters<typeof JSON.stringify>[1];
}

export class JSONLStringifyStream<T = unknown> extends TransformStream<
	T,
	string
> {
	constructor(options: JSONLStringifyStreamOptions = {}) {
		super({
			transform(value, controller) {
				const json = JSON.stringify(value, options.replacer);

				if (json === undefined) {
					throw new TypeError("Value is not representable as JSON");
				}

				controller.enqueue(`${json}\n`);
			},
		});
	}
}

export class JSONLEncodeStream<T = unknown> extends TransformStream<
	T,
	Uint8Array
> {
	constructor(options: JSONLStringifyStreamOptions = {}) {
		const encoder = new TextEncoder();

		super({
			transform(value, controller) {
				const json = JSON.stringify(value, options.replacer);

				if (json === undefined) {
					throw new TypeError("Value is not representable as JSON");
				}

				controller.enqueue(encoder.encode(`${json}\n`));
			},
		});
	}
}

export function stringifyJSONLStream<T>(
	input: ReadableStream<T>,
	options?: JSONLStringifyStreamOptions,
): ReadableStream<string>;
export function stringifyJSONLStream<T>(
	input: Iterable<T> | AsyncIterable<T>,
	options?: JSONLStringifyStreamOptions,
): ReadableStream<string>;
export function stringifyJSONLStream<T>(
	input: ReadableStream<T> | Iterable<T> | AsyncIterable<T>,
	options: JSONLStringifyStreamOptions = {},
): ReadableStream<string> {
	return toReadableStream(input).pipeThrough(
		new JSONLStringifyStream<T>(options),
	);
}

export function encodeJSONLStream<T>(
	input: ReadableStream<T>,
	options?: JSONLStringifyStreamOptions,
): ReadableStream<Uint8Array>;
export function encodeJSONLStream<T>(
	input: Iterable<T> | AsyncIterable<T>,
	options?: JSONLStringifyStreamOptions,
): ReadableStream<Uint8Array>;
export function encodeJSONLStream<T>(
	input: ReadableStream<T> | Iterable<T> | AsyncIterable<T>,
	options: JSONLStringifyStreamOptions = {},
): ReadableStream<Uint8Array> {
	return toReadableStream(input).pipeThrough(new JSONLEncodeStream<T>(options));
}

function toReadableStream<T>(
	input: ReadableStream<T> | Iterable<T> | AsyncIterable<T>,
): ReadableStream<T> {
	if (isInstance(input, ReadableStream)) {
		return input;
	}

	const iterator =
		Symbol.asyncIterator in input
			? input[Symbol.asyncIterator]()
			: toAsyncIterator(input[Symbol.iterator]());

	return new ReadableStream<T>({
		async pull(controller) {
			const result = await iterator.next();

			if (result.done) {
				controller.close();
				return;
			}

			controller.enqueue(result.value);
		},

		async cancel(reason) {
			if ("throw" in iterator && typeof iterator.throw === "function") {
				await iterator.throw(reason);
			}
		},
	});
}

async function* toAsyncIterator<T>(iterator: Iterator<T>): AsyncGenerator<T> {
	while (true) {
		const result = iterator.next();

		if (result.done) {
			return;
		}

		yield result.value;
	}
}
