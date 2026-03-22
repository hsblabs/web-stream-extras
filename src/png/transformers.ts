import { readAllBytes } from "../readable";
import { throwError } from "../shared/error";
import { concatU8Arrays } from "../shared/uint8array";
import { crc32 } from "./crc32";
import {
	getInternalTextChunkPayload,
	isInternalTextChunk,
	parsePayloadSegment,
	parsePNGBytes,
	rebuildPNGWithPayload,
} from "./framing";
import type { PNGTextChunkWriteOptions, PNGTextChunkWriter } from "./public";

interface Deferred<T> {
	promise: Promise<T>;
	reject(reason?: unknown): void;
	resolve(value: T | PromiseLike<T>): void;
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((innerResolve, innerReject) => {
		resolve = innerResolve;
		reject = innerReject;
	});
	void promise.catch(() => {});

	return { promise, reject, resolve };
}

function normalizeReason(reason: unknown): unknown {
	return reason ?? new Error("PNG stream was canceled");
}

export function createPNGTextChunkWriterImpl(
	png: ReadableStream<Uint8Array>,
	{ onExisting = "error" }: PNGTextChunkWriteOptions = {},
): PNGTextChunkWriter {
	const sourceReader = png.getReader();
	const payloadChunks: Uint8Array[] = [];
	const payloadClosed = createDeferred<void>();
	const completion = createDeferred<void>();
	let failure: unknown;

	async function cancelSource(reason: unknown): Promise<void> {
		try {
			await sourceReader.cancel(reason);
		} catch {}
	}

	function fail(reason: unknown): void {
		if (failure !== undefined) {
			return;
		}

		failure = normalizeReason(reason);
		payloadClosed.reject(failure);
		completion.reject(failure);
	}

	const sourceBytesPromise = (async () => {
		const chunks: Uint8Array[] = [];

		while (true) {
			const { done, value } = await sourceReader.read();
			if (done) {
				return concatU8Arrays(...chunks);
			}

			chunks.push(value.slice());
		}
	})().catch((error) => {
		fail(error);
		throw error;
	});

	const readable = new ReadableStream<Uint8Array>({
		async cancel(reason) {
			fail(reason);
			await cancelSource(failure);
		},
		async start(controller) {
			try {
				const [sourceBytes] = await Promise.all([
					sourceBytesPromise,
					payloadClosed.promise,
				]);
				const payload = concatU8Arrays(...payloadChunks);
				const rebuilt = rebuildPNGWithPayload(sourceBytes, payload, onExisting);

				controller.enqueue(rebuilt);
				controller.close();
				completion.resolve();
			} catch (error) {
				const reason = failure ?? error;
				fail(reason);
				controller.error(reason);
			}
		},
	});

	const writable = new WritableStream<Uint8Array>({
		async abort(reason) {
			fail(reason);
			await cancelSource(failure);
		},
		close() {
			if (failure !== undefined) {
				return Promise.reject(failure);
			}

			payloadClosed.resolve();
			return completion.promise;
		},
		write(chunk) {
			if (failure !== undefined) {
				return Promise.reject(failure);
			}

			payloadChunks.push(chunk.slice());
		},
	});

	return { readable, writable };
}

export function extractPNGTextChunkImpl(
	png: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				const chunks = parsePNGBytes(await readAllBytes(png), {
					requireIEND: true,
				});
				const payloadParts: Uint8Array[] = [];
				let expectedIndex = 0;
				let expectedCount: number | null = null;
				let expectedPayloadCrc: number | null = null;

				for (const chunk of chunks) {
					if (!isInternalTextChunk(chunk)) {
						continue;
					}

					const segment = parsePayloadSegment(
						getInternalTextChunkPayload(chunk),
					);

					if (expectedCount === null) {
						expectedCount = segment.segmentCount;
						expectedPayloadCrc = segment.payloadCrc32;
					}

					if (
						segment.segmentCount !== expectedCount ||
						segment.payloadCrc32 !== expectedPayloadCrc
					) {
						throwError("PNG payload segment header is inconsistent");
					}
					if (segment.segmentIndex !== expectedIndex) {
						throwError("PNG payload segment index is invalid");
					}
					if (segment.segmentIndex === 0 && !segment.isFirst) {
						throwError("PNG payload first segment flag is invalid");
					}
					if (
						segment.segmentIndex === segment.segmentCount - 1 &&
						!segment.isLast
					) {
						throwError("PNG payload last segment flag is invalid");
					}

					payloadParts.push(segment.segmentData.slice());
					expectedIndex++;
				}

				if (expectedCount === null || expectedPayloadCrc === null) {
					throwError("PNG does not contain an embedded payload");
				}
				if (expectedIndex !== expectedCount) {
					throwError("PNG payload segment count is incomplete");
				}

				const payload = concatU8Arrays(...payloadParts);
				if (crc32(payload) !== expectedPayloadCrc) {
					throwError("PNG payload CRC mismatch");
				}

				controller.enqueue(payload);
				controller.close();
			} catch (error) {
				controller.error(error);
			}
		},
	});
}
