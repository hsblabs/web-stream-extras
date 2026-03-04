import { performance } from "node:perf_hooks";
import { DecryptionStream, EncryptionStream } from "../dist/encryption.js";
import { readAllBytes, readableFromChunks } from "../dist/index.js";

const BENCH_RECORD_SIZE = 64 * 1024;
const MEGABYTE = 1024 * 1024;
const LARGE_PAYLOAD = createPatternBytes(MEGABYTE);
const BYTE_SPLIT_PAYLOAD = createPatternBytes(128 * 1024);
const ENC_KEY = createPatternBytes(32);
const SALT = new Uint8Array(16).fill(4);

function createPatternBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);

	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = i & 0xff;
	}

	return bytes;
}

function splitBytes(data: Uint8Array, chunkSize: number): Uint8Array[] {
	const chunks: Uint8Array[] = [];

	for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
		chunks.push(data.slice(offset, offset + chunkSize));
	}

	return chunks;
}

function splitIntoSingleBytes(data: Uint8Array): Uint8Array[] {
	return Array.from(data, (value) => new Uint8Array([value]));
}

async function encryptPayload(
	inputChunks: Uint8Array | Uint8Array[],
): Promise<Uint8Array> {
	return readAllBytes(
		readableFromChunks(inputChunks).pipeThrough(
			new EncryptionStream(ENC_KEY, {
				recordSize: BENCH_RECORD_SIZE,
				salt: SALT,
			}),
		),
	);
}

async function decryptPayload(
	chunks: Uint8Array | Uint8Array[],
): Promise<Uint8Array> {
	return readAllBytes(
		readableFromChunks(chunks).pipeThrough(new DecryptionStream(ENC_KEY)),
	);
}

function summarizeDurations(durations: number[]): {
	avg: number;
	max: number;
	min: number;
} {
	const total = durations.reduce((sum, duration) => sum + duration, 0);

	return {
		avg: total / durations.length,
		min: Math.min(...durations),
		max: Math.max(...durations),
	};
}

async function runBenchmark(
	name: string,
	iterations: number,
	run: () => Promise<void>,
): Promise<void> {
	const durations: number[] = [];

	for (let i = 0; i < iterations; i++) {
		const startedAt = performance.now();
		await run();
		durations.push(performance.now() - startedAt);
	}

	const { avg, min, max } = summarizeDurations(durations);
	console.log(
		`${name}: avg=${avg.toFixed(2)}ms min=${min.toFixed(2)}ms max=${max.toFixed(
			2,
		)}ms (${iterations} runs)`,
	);
}

const largePayloadChunks = splitBytes(LARGE_PAYLOAD, BENCH_RECORD_SIZE);
const encryptedLargePayload = await encryptPayload(largePayloadChunks);
const encryptedLargePayloadChunks = splitBytes(
	encryptedLargePayload,
	BENCH_RECORD_SIZE,
);
const byteSplitPayloadChunks = splitIntoSingleBytes(BYTE_SPLIT_PAYLOAD);

console.log("web-stream-extras encryption benchmark");
await runBenchmark("encrypt 1 MiB / 64 KiB chunks", 5, async () => {
	await encryptPayload(largePayloadChunks);
});
await runBenchmark("decrypt 1 MiB / 64 KiB chunks", 5, async () => {
	await decryptPayload(encryptedLargePayloadChunks);
});
await runBenchmark("encrypt 128 KiB / 1-byte chunks", 3, async () => {
	await encryptPayload(byteSplitPayloadChunks);
});
