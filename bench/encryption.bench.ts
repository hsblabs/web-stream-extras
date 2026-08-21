import { performance } from "node:perf_hooks";
import {
	DecryptionStream,
	EncryptionStream,
} from "../dist/encryption/index.js";

type Direction = "decrypt" | "encrypt";
type ChunkMode =
	| "1-byte"
	| "16-kib"
	| "64-kib"
	| "record-aligned"
	| "record-plus-one";

interface BenchCase {
	direction: Direction;
	recordSize: number;
	chunkMode: ChunkMode;
	maxInFlightRecords: number;
	payload: Uint8Array;
	ciphertext: Uint8Array;
}

interface SourceStats {
	pulledBytes: number;
	pulledChunks: number;
}

interface RunResult {
	arrayBuffersMiB: number;
	elapsedMs: number;
	firstDataMs: number;
	inputBytesAtFirstData: number;
	outputBytes: number;
	outputChunks: number;
	recordChunks: number;
	rssMiB: number;
}

const KIBIBYTE = 1024;
const MEBIBYTE = 1024 * KIBIBYTE;
const TAG_AND_DELIMITER_LENGTH = 17;
const ENCRYPTION_HEADER_LENGTH = 21;
const HEADER_CHUNKS = 1;
const ENC_KEY = createPatternBytes(32);
const SALT = new Uint8Array(16).fill(4);
const QUICK = process.env.BENCH_QUICK === "1";
const LARGE_PAYLOAD = createPatternBytes((QUICK ? 8 : 64) * MEBIBYTE);
const ONE_BYTE_PAYLOAD = LARGE_PAYLOAD.subarray(
	0,
	QUICK ? 64 * KIBIBYTE : 512 * KIBIBYTE,
);
const RECORD_SIZES = QUICK
	? [64 * KIBIBYTE, 4 * MEBIBYTE]
	: [64 * KIBIBYTE, MEBIBYTE, 4 * MEBIBYTE];
const CHUNK_MODES: ChunkMode[] = QUICK
	? ["64-kib", "record-aligned", "record-plus-one"]
	: ["16-kib", "64-kib", "record-aligned", "record-plus-one"];
const MAX_IN_FLIGHT_RECORDS = [1, 2, 4];
const SAMPLE_COUNT = QUICK ? 1 : 3;

function createPatternBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);

	for (let index = 0; index < bytes.length; index++) {
		bytes[index] = index & 0xff;
	}

	return bytes;
}

function createLazyViewSource(
	data: Uint8Array,
	chunkSize: number,
): { stats: SourceStats; stream: ReadableStream<Uint8Array> } {
	let offset = 0;
	const stats: SourceStats = { pulledBytes: 0, pulledChunks: 0 };

	return {
		stats,
		stream: new ReadableStream({
			pull(controller) {
				if (offset === data.byteLength) {
					controller.close();
					return;
				}

				const end = Math.min(offset + chunkSize, data.byteLength);
				const chunk = data.subarray(offset, end);
				offset = end;
				stats.pulledBytes += chunk.byteLength;
				stats.pulledChunks++;
				controller.enqueue(chunk);
			},
		}),
	};
}

async function collectBytes(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let byteLength = 0;

	for await (const chunk of stream) {
		chunks.push(chunk);
		byteLength += chunk.byteLength;
	}

	const result = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

async function createCiphertext(
	payload: Uint8Array,
	recordSize: number,
): Promise<Uint8Array> {
	const { stream } = createLazyViewSource(payload, 64 * KIBIBYTE);
	return collectBytes(
		stream.pipeThrough(
			new EncryptionStream(ENC_KEY, {
				maxInFlightRecords: 1,
				recordSize,
				salt: SALT,
			}),
		),
	);
}

function resolveChunkSize(
	direction: Direction,
	recordSize: number,
	chunkMode: ChunkMode,
): number {
	if (chunkMode === "1-byte") return 1;
	if (chunkMode === "16-kib") return 16 * KIBIBYTE;
	if (chunkMode === "64-kib") return 64 * KIBIBYTE;

	const alignedSize =
		direction === "encrypt"
			? recordSize - TAG_AND_DELIMITER_LENGTH
			: recordSize;
	return chunkMode === "record-aligned" ? alignedSize : alignedSize + 1;
}

function sampleMemory(peak: NodeJS.MemoryUsage): NodeJS.MemoryUsage {
	const current = process.memoryUsage();
	return {
		arrayBuffers: Math.max(peak.arrayBuffers, current.arrayBuffers),
		external: Math.max(peak.external, current.external),
		heapTotal: Math.max(peak.heapTotal, current.heapTotal),
		heapUsed: Math.max(peak.heapUsed, current.heapUsed),
		rss: Math.max(peak.rss, current.rss),
	};
}

async function drainAndMeasure(
	stream: ReadableStream<Uint8Array>,
	stats: SourceStats,
	logicalInputBytes: number,
	skipLeadingChunks: number,
): Promise<RunResult> {
	globalThis.gc?.();
	const baseline = process.memoryUsage();
	let peak = baseline;
	const startedAt = performance.now();
	let firstDataMs = Number.NaN;
	let inputBytesAtFirstData = 0;
	let outputBytes = 0;
	let outputChunks = 0;
	let recordChunks = 0;
	const memoryTimer = setInterval(() => {
		peak = sampleMemory(peak);
	}, 5);

	try {
		for await (const chunk of stream) {
			outputBytes += chunk.byteLength;
			outputChunks++;

			if (outputChunks <= skipLeadingChunks) continue;
			recordChunks++;
			if (Number.isNaN(firstDataMs)) {
				firstDataMs = performance.now() - startedAt;
				inputBytesAtFirstData = stats.pulledBytes;
			}
		}
	} finally {
		clearInterval(memoryTimer);
		peak = sampleMemory(peak);
	}

	const elapsedMs = performance.now() - startedAt;
	if (logicalInputBytes > 0 && Number.isNaN(firstDataMs)) {
		throw new Error("Stream produced no data records");
	}

	return {
		arrayBuffersMiB: Math.max(
			0,
			(peak.arrayBuffers - baseline.arrayBuffers) / MEBIBYTE,
		),
		elapsedMs,
		firstDataMs,
		inputBytesAtFirstData,
		outputBytes,
		outputChunks,
		recordChunks,
		rssMiB: Math.max(0, (peak.rss - baseline.rss) / MEBIBYTE),
	};
}

async function runCase(caseDefinition: BenchCase): Promise<RunResult> {
	const {
		ciphertext,
		direction,
		maxInFlightRecords,
		payload,
		recordSize,
		chunkMode,
	} = caseDefinition;
	const input = direction === "encrypt" ? payload : ciphertext;
	const { stats, stream } = createLazyViewSource(
		input,
		resolveChunkSize(direction, recordSize, chunkMode),
	);
	const output =
		direction === "encrypt"
			? stream.pipeThrough(
					new EncryptionStream(ENC_KEY, {
						maxInFlightRecords,
						recordSize,
						salt: SALT,
					}),
				)
			: stream.pipeThrough(
					new DecryptionStream(ENC_KEY, { maxInFlightRecords }),
				);

	return drainAndMeasure(
		output,
		stats,
		payload.byteLength,
		direction === "encrypt" ? HEADER_CHUNKS : 0,
	);
}

function median(values: number[]): number {
	const sorted = values.toSorted((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function toMiBs(byteLength: number, elapsedMs: number): number {
	return byteLength / MEBIBYTE / (elapsedMs / 1000);
}

function assertResult(caseDefinition: BenchCase, result: RunResult): void {
	const recordCount = Math.ceil(
		caseDefinition.payload.byteLength /
			(caseDefinition.recordSize - TAG_AND_DELIMITER_LENGTH),
	);
	const expectedOutputChunks =
		recordCount + (caseDefinition.direction === "encrypt" ? HEADER_CHUNKS : 0);
	const expectedOutputBytes =
		caseDefinition.direction === "encrypt"
			? ENCRYPTION_HEADER_LENGTH +
				caseDefinition.payload.byteLength +
				recordCount * TAG_AND_DELIMITER_LENGTH
			: caseDefinition.payload.byteLength;

	if (
		result.outputChunks !== expectedOutputChunks ||
		result.recordChunks !== recordCount ||
		result.outputBytes !== expectedOutputBytes
	) {
		throw new Error(
			`Unexpected output for ${caseDefinition.direction} ${caseDefinition.recordSize} ${caseDefinition.chunkMode}`,
		);
	}
}

async function printSamples(caseDefinition: BenchCase): Promise<void> {
	const results: RunResult[] = [];
	for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
		const result = await runCase(caseDefinition);
		assertResult(caseDefinition, result);
		results.push(result);
	}

	const representative = results.toSorted(
		(left, right) => left.elapsedMs - right.elapsedMs,
	)[Math.floor(results.length / 2)];
	if (!representative) return;

	const throughput = median(
		results.map((result) =>
			toMiBs(caseDefinition.payload.byteLength, result.elapsedMs),
		),
	);
	console.log(
		[
			caseDefinition.direction,
			caseDefinition.recordSize / KIBIBYTE,
			caseDefinition.chunkMode,
			caseDefinition.payload.byteLength / KIBIBYTE,
			caseDefinition.maxInFlightRecords,
			throughput.toFixed(1),
			median(results.map((result) => result.firstDataMs)).toFixed(2),
			representative.inputBytesAtFirstData,
			Math.max(...results.map((result) => result.rssMiB)).toFixed(2),
			Math.max(...results.map((result) => result.arrayBuffersMiB)).toFixed(2),
			representative.outputChunks,
			representative.recordChunks,
			representative.outputBytes,
		].join("\t"),
	);
}

console.log(`web-stream-extras encryption benchmark (${process.version})`);
console.log(
	[
		"direction",
		"recordKiB",
		"sourceChunk",
		"payloadKiB",
		"maxInFlight",
		"MiB/s",
		"firstDataMs",
		"inputBytesAtFirstData",
		"peakRssDeltaMiB",
		"peakArrayBuffersDeltaMiB",
		"outputChunks",
		"recordChunks",
		"outputBytes",
	].join("\t"),
);

for (const recordSize of RECORD_SIZES) {
	const largeCiphertext = await createCiphertext(LARGE_PAYLOAD, recordSize);
	for (const chunkMode of CHUNK_MODES) {
		for (const maxInFlightRecords of MAX_IN_FLIGHT_RECORDS) {
			for (const direction of ["encrypt", "decrypt"] as const) {
				await printSamples({
					ciphertext: largeCiphertext,
					chunkMode,
					direction,
					maxInFlightRecords,
					payload: LARGE_PAYLOAD,
					recordSize,
				});
			}
		}
	}
}

const oneByteRecordSize = 64 * KIBIBYTE;
const oneByteCiphertext = await createCiphertext(
	ONE_BYTE_PAYLOAD,
	oneByteRecordSize,
);
for (const maxInFlightRecords of MAX_IN_FLIGHT_RECORDS) {
	for (const direction of ["encrypt", "decrypt"] as const) {
		await printSamples({
			ciphertext: oneByteCiphertext,
			chunkMode: "1-byte",
			direction,
			maxInFlightRecords,
			payload: ONE_BYTE_PAYLOAD,
			recordSize: oneByteRecordSize,
		});
	}
}
