import { concatU8Arrays } from "./shared/uint8array";
import type { BinaryReadableStream } from "./stream-types";

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
