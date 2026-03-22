import {
	createPNGTextChunkWriterImpl,
	extractPNGTextChunkImpl,
} from "./transformers";

export interface PNGTextChunkWriteOptions {
	onExisting?: "error" | "replace";
}

export interface PNGTextChunkWriter {
	writable: WritableStream<Uint8Array>;
	readable: ReadableStream<Uint8Array>;
}

export function createPNGTextChunkWriter(
	png: ReadableStream<Uint8Array>,
	options?: PNGTextChunkWriteOptions,
): PNGTextChunkWriter {
	return createPNGTextChunkWriterImpl(png, options);
}

export function extractPNGTextChunk(
	png: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	return extractPNGTextChunkImpl(png);
}
