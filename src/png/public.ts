import {
	createPNGTextChunkWriterImpl,
	extractPNGTextChunkImpl,
	streamPNGTextChunkImpl,
} from "./transformers";

export interface PNGTextChunkWriteOptions {
	onExisting?: "error" | "replace";
}

export interface PNGTextChunkWriter {
	writable: WritableStream<Uint8Array>;
	readable: ReadableStream<Uint8Array>;
}

/**
 * Rebuilds a PNG by forwarding validated source chunks, appending internal
 * payload chunks immediately before the final `IEND`.
 */
export function createPNGTextChunkWriter(
	png: ReadableStream<Uint8Array>,
	options?: PNGTextChunkWriteOptions,
): PNGTextChunkWriter {
	return createPNGTextChunkWriterImpl(png, options);
}

/**
 * Extracts the embedded payload with all-or-nothing semantics.
 *
 * The returned stream emits only after the terminal manifest and payload CRC
 * have been validated.
 */
export function extractPNGTextChunk(
	png: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	return extractPNGTextChunkImpl(png);
}

/**
 * Extracts the embedded payload as soon as data segments arrive.
 *
 * This late-error variant may emit partial payload bytes before rejecting if
 * the terminal manifest or payload CRC is invalid.
 */
export function streamPNGTextChunk(
	png: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	return streamPNGTextChunkImpl(png);
}
