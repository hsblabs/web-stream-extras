import { isInstance } from "./is";

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

async function* toAsyncIterator<T>(iterator: Iterator<T>): AsyncGenerator<T> {
	while (true) {
		const result = iterator.next();

		if (result.done) {
			return;
		}

		yield result.value;
	}
}
