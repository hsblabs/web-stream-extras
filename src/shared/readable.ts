import type { BinaryReadableStream } from "../stream-types";
import { isInstance } from "./is";
import { concatU8Arrays } from "./uint8array";

export function toReadableStream<T>(
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

export function readableFromChunks<T>(chunks: T | T[]): ReadableStream<T> {
	const queue = Array.isArray(chunks) ? chunks : [chunks];

	return new ReadableStream({
		start(controller) {
			for (const chunk of queue) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
}

export async function readAllChunks<T>(
	stream: ReadableStream<T>,
): Promise<T[]> {
	const reader = stream.getReader();
	const chunks: T[] = [];

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			return chunks;
		}
		chunks.push(value);
	}
}

export async function readAllBytes(
	stream: BinaryReadableStream,
): Promise<Uint8Array> {
	return concatU8Arrays(...(await readAllChunks(stream)));
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
