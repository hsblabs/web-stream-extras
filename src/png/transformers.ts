import { type ByteQueue, createByteQueue } from "../byte-queue";
import { throwError } from "../shared/error";
import { concatU8Arrays } from "../shared/uint8array";
import {
	PNG_IEND_CHUNK_TYPE,
	PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH,
	PNG_SIGNATURE,
} from "./constants";
import { createCRC32State, finalizeCRC32, updateCRC32 } from "./crc32";
import {
	assertPNGSignature,
	createPayloadDataSegment,
	createPayloadManifestSegment,
	createTextChunk,
	getInternalTextChunkPayload,
	isInternalTextChunk,
	parsePayloadSegment,
	parsePNGChunk,
	parsePNGChunkHeader,
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
	void promise.catch(() => { });

	return { promise, reject, resolve };
}

function normalizeReason(reason: unknown): unknown {
	return reason ?? new Error("PNG stream was canceled");
}

interface PayloadWriteRequest {
	ack: Deferred<void>;
	chunk: Uint8Array;
}

async function cancelSourceReader(
	sourceReader: ReadableStreamDefaultReader<Uint8Array>,
	reason: unknown,
): Promise<void> {
	try {
		await sourceReader.cancel(reason);
	} catch { }
}

async function readPNGSignature(
	sourceReader: ReadableStreamDefaultReader<Uint8Array>,
	queue: ByteQueue,
): Promise<Uint8Array> {
	while (queue.byteLength < PNG_SIGNATURE.byteLength) {
		const { done, value } = await sourceReader.read();
		if (done) {
			throwError("PNG signature is truncated");
		}

		queue.append(value);
	}

	const signature = queue.read(PNG_SIGNATURE.byteLength);
	assertPNGSignature(signature);
	return signature;
}

async function readSourceChunkBytes(
	sourceReader: ReadableStreamDefaultReader<Uint8Array>,
	queue: ByteQueue,
): Promise<Uint8Array | null> {
	while (queue.byteLength < 8) {
		const { done, value } = await sourceReader.read();
		if (done) {
			if (queue.byteLength === 0) {
				return null;
			}
			throwError("PNG chunk header is truncated");
		}

		queue.append(value);
	}

	const header = queue.read(8);
	const { length } = parsePNGChunkHeader(header);

	while (queue.byteLength < length + 4) {
		const { done, value } = await sourceReader.read();
		if (done) {
			throwError("PNG chunk data is truncated");
		}

		queue.append(value);
	}

	const tail = queue.read(length + 4);
	const raw = new Uint8Array(8 + tail.byteLength);
	raw.set(header, 0);
	raw.set(tail, 8);
	return raw;
}

async function assertNoTrailingBytes(
	sourceReader: ReadableStreamDefaultReader<Uint8Array>,
	queue: ByteQueue,
): Promise<void> {
	if (queue.byteLength !== 0) {
		throwError("PNG has trailing bytes after IEND");
	}

	while (true) {
		const { done, value } = await sourceReader.read();
		if (done) {
			return;
		}
		if (value.byteLength !== 0) {
			throwError("PNG has trailing bytes after IEND");
		}
	}
}

export function createPNGTextChunkWriterImpl(
	png: ReadableStream<Uint8Array>,
	{ onExisting = "error" }: PNGTextChunkWriteOptions = {},
): PNGTextChunkWriter {
	const sourceReader = png.getReader();
	const completion = createDeferred<void>();
	const sourceValidated = createDeferred<void>();
	const payloadWrites: PayloadWriteRequest[] = [];
	let payloadClosed = false;
	let payloadNotifier = createDeferred<void>();
	let outputNotifier = createDeferred<void>();
	const outputChunks: Uint8Array[] = [];
	const sourceQueue = createByteQueue();
	let sourcePump: Promise<void> | null = null;
	let iendChunkRaw: Uint8Array | null = null;
	let outputClosed = false;
	let failure: unknown;

	function fail(reason: unknown): void {
		if (failure !== undefined) {
			return;
		}

		failure = normalizeReason(reason);
		for (const request of payloadWrites.splice(0)) {
			request.ack.reject(failure);
		}
		sourceValidated.reject(failure);
		completion.reject(failure);
		outputNotifier.resolve();
		payloadNotifier.resolve();
	}

	function notifyPayload(): void {
		payloadNotifier.resolve();
	}

	function enqueueOutput(chunk: Uint8Array): void {
		outputChunks.push(chunk);
		outputNotifier.resolve();
	}

	async function waitForPayloadActivity(): Promise<void> {
		const current = payloadNotifier;
		await current.promise;
		if (payloadNotifier === current) {
			payloadNotifier = createDeferred<void>();
		}
	}

	async function waitForOutputActivity(): Promise<void> {
		const current = outputNotifier;
		await current.promise;
		if (outputNotifier === current) {
			outputNotifier = createDeferred<void>();
		}
	}

	const initializePromise = (async () => {
		try {
			enqueueOutput(await readPNGSignature(sourceReader, sourceQueue));
		} catch (error) {
			const reason = failure ?? error;
			fail(reason);
			await cancelSourceReader(sourceReader, reason);
		}
	})();
	void initializePromise.catch(() => { });

	function startSourcePump(): void {
		if (sourcePump) {
			return;
		}

		sourcePump = (async () => {
			try {
				await initializePromise;
				if (failure !== undefined) {
					throw failure;
				}

				while (true) {
					const raw = await readSourceChunkBytes(sourceReader, sourceQueue);
					if (!raw) {
						throwError("PNG is missing IEND");
					}

					const chunk = parsePNGChunk(raw);
					if (chunk.type === PNG_IEND_CHUNK_TYPE) {
						if (chunk.length !== 0) {
							throwError("PNG IEND chunk must be empty");
						}

						iendChunkRaw = chunk.raw;
						break;
					}

					if (isInternalTextChunk(chunk)) {
						if (onExisting === "error") {
							throwError("PNG already contains an embedded payload");
						}

						continue;
					}

					enqueueOutput(chunk.raw);
				}

				await assertNoTrailingBytes(sourceReader, sourceQueue);
				sourceValidated.resolve();

				let payloadCrcState = createCRC32State();
				let segmentCount = 0;

				while (true) {
					while (payloadWrites.length > 0) {
						const request = payloadWrites.shift();
						if (!request) {
							continue;
						}

						payloadCrcState = updateCRC32(payloadCrcState, request.chunk);

						for (
							let offset = 0;
							offset < request.chunk.byteLength;
							offset += PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH
						) {
							const next = Math.min(
								offset + PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH,
								request.chunk.byteLength,
							);
							enqueueOutput(
								createTextChunk(
									createPayloadDataSegment({
										segmentData: request.chunk.subarray(offset, next),
										segmentIndex: segmentCount,
									}),
								),
							);
							segmentCount++;
						}
					}

					if (payloadClosed) {
						break;
					}

					await waitForPayloadActivity();
					if (failure !== undefined) {
						throw failure;
					}
				}

				enqueueOutput(
					createTextChunk(
						createPayloadManifestSegment({
							payloadCrc32: finalizeCRC32(payloadCrcState),
							segmentCount,
						}),
					),
				);
				if (!iendChunkRaw) {
					throwError("PNG is missing IEND");
				}
				enqueueOutput(iendChunkRaw);
				outputClosed = true;
				outputNotifier.resolve();
				completion.resolve();
			} catch (error) {
				const reason = failure ?? error;
				fail(reason);
				await cancelSourceReader(sourceReader, reason);
			}
		})();
		void sourcePump.catch(() => { });
	}

	const readable = new ReadableStream<Uint8Array>({
		async cancel(reason) {
			fail(reason);
			await cancelSourceReader(sourceReader, failure);
		},
		async pull(controller) {
			await initializePromise;

			while (outputChunks.length === 0) {
				if (failure !== undefined) {
					controller.error(failure);
					return;
				}
				if (outputClosed) {
					controller.close();
					return;
				}

				startSourcePump();
				await waitForOutputActivity();
			}

			if (failure !== undefined) {
				controller.error(failure);
				return;
			}

			const next = outputChunks.shift();
			if (!next) {
				controller.close();
				return;
			}

			controller.enqueue(next);
		},
	});

	const writable = new WritableStream<Uint8Array>({
		async abort(reason) {
			fail(reason);
			await cancelSourceReader(sourceReader, failure);
		},
		close() {
			if (failure !== undefined) {
				return Promise.reject(failure);
			}

			payloadClosed = true;
			startSourcePump();
			notifyPayload();
			return completion.promise;
		},
		write(chunk) {
			if (failure !== undefined) {
				return Promise.reject(failure);
			}

			const request = {
				ack: createDeferred<void>(),
				chunk: chunk.slice(),
			};
			void sourceValidated.promise.then(
				() => request.ack.resolve(),
				(reason) => request.ack.reject(reason),
			);

			payloadWrites.push(request);
			startSourcePump();
			notifyPayload();
			return request.ack.promise;
		},
	});

	return { readable, writable };
}

export function extractPNGTextChunkImpl(
	png: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	const sourceReader = streamPNGTextChunkImpl(png).getReader();
	let canceled = false;

	return new ReadableStream<Uint8Array>({
		async cancel(reason) {
			canceled = true;
			await sourceReader.cancel(reason);
		},
		async start(controller) {
			try {
				const parts: Uint8Array[] = [];

				while (true) {
					const { done, value } = await sourceReader.read();
					if (done) {
						break;
					}

					parts.push(value);
				}

				if (canceled) {
					return;
				}

				controller.enqueue(concatU8Arrays(...parts));
				controller.close();
			} catch (error) {
				if (canceled) {
					return;
				}

				controller.error(error);
			}
		},
	});
}

export function streamPNGTextChunkImpl(
	png: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	const sourceReader = png.getReader();
	let cancelReason: unknown;
	const iterator = (async function* (): AsyncGenerator<Uint8Array, void, void> {
		let completed = false;

		try {
			const sourceQueue = createByteQueue();
			await readPNGSignature(sourceReader, sourceQueue);

			let expectedIndex = 0;
			let manifest: ReturnType<typeof parsePayloadSegment> | null = null;
			let payloadCrcState = createCRC32State();

			while (true) {
				const raw = await readSourceChunkBytes(sourceReader, sourceQueue);
				if (!raw) {
					throwError("PNG is missing IEND");
				}

				const chunk = parsePNGChunk(raw);
				if (chunk.type === PNG_IEND_CHUNK_TYPE) {
					if (chunk.length !== 0) {
						throwError("PNG IEND chunk must be empty");
					}

					break;
				}

				if (!isInternalTextChunk(chunk)) {
					continue;
				}

				const segment = parsePayloadSegment(getInternalTextChunkPayload(chunk));

				if (segment.kind === "manifest") {
					if (manifest) {
						throwError("PNG payload manifest is duplicated");
					}

					manifest = segment;
					continue;
				}

				if (manifest) {
					throwError("PNG payload data appears after manifest");
				}

				if (segment.segmentIndex !== expectedIndex) {
					throwError("PNG payload segment index is invalid");
				}

				payloadCrcState = updateCRC32(payloadCrcState, segment.segmentData);
				expectedIndex++;
				yield segment.segmentData.slice();
			}

			await assertNoTrailingBytes(sourceReader, sourceQueue);

			if (!manifest || manifest.kind !== "manifest") {
				throwError("PNG does not contain an embedded payload");
			}
			if (expectedIndex !== manifest.segmentCount) {
				throwError("PNG payload segment count is incomplete");
			}
			if (finalizeCRC32(payloadCrcState) !== manifest.payloadCrc32) {
				throwError("PNG payload CRC mismatch");
			}

			completed = true;
		} finally {
			if (!completed) {
				await cancelSourceReader(sourceReader, cancelReason);
			}
		}
	})();

	return new ReadableStream<Uint8Array>({
		async cancel(reason) {
			cancelReason = reason;
			await Promise.allSettled([
				cancelSourceReader(sourceReader, reason),
				iterator.return(undefined),
			]);
		},
		async pull(controller) {
			try {
				const { done, value } = await iterator.next();
				if (done) {
					controller.close();
					return;
				}

				controller.enqueue(value);
			} catch (error) {
				controller.error(error);
			}
		},
	});
}
