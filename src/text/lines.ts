import { toReadableStream } from "../shared/readable";
import type { TextDecodeStreamOptions, TextInputChunk } from "./codec";

export interface LineSplitStreamOptions extends TextDecodeStreamOptions {
	keepLineBreaks?: boolean;
	maxLineChars?: number;
}

export interface LineJoinStreamOptions {
	lineBreak?: string;
}

export class LineSplitStream extends TransformStream<TextInputChunk, string> {
	constructor(options: LineSplitStreamOptions = {}) {
		const decoder = new TextDecoder(options.encoding ?? "utf-8", {
			fatal: options.fatal ?? false,
			ignoreBOM: options.ignoreBOM ?? false,
		});
		const keepLineBreaks = options.keepLineBreaks ?? false;
		const maxLineChars = options.maxLineChars;

		let buffer = "";

		const assertLineSize = (line: string): void => {
			if (maxLineChars !== undefined && line.length > maxLineChars) {
				throw new RangeError(
					`Line exceeded maxLineChars: ${line.length} > ${maxLineChars}`,
				);
			}
		};

		const decodeChunk = (chunk: TextInputChunk): string => {
			if (typeof chunk === "string") {
				return chunk;
			}

			return decoder.decode(chunk, { stream: true });
		};

		const enqueueLine = (
			rawLine: string,
			controller: TransformStreamDefaultController<string>,
		): void => {
			const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
			assertLineSize(line);
			controller.enqueue(keepLineBreaks ? `${rawLine}\n` : line);
		};

		super({
			transform(chunk, controller) {
				buffer += decodeChunk(chunk);

				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				assertLineSize(buffer);

				for (const line of lines) {
					enqueueLine(line, controller);
				}
			},

			flush(controller) {
				buffer += decoder.decode();
				assertLineSize(buffer);

				if (buffer !== "") {
					controller.enqueue(buffer);
				}
			},
		});
	}
}

export class LineJoinStream extends TransformStream<string, string> {
	constructor(options: LineJoinStreamOptions = {}) {
		const lineBreak = options.lineBreak ?? "\n";

		super({
			transform(line, controller) {
				controller.enqueue(`${line}${lineBreak}`);
			},
		});
	}
}

export function splitLinesStream(
	input: ReadableStream<TextInputChunk>,
	options?: LineSplitStreamOptions,
): ReadableStream<string> {
	return input.pipeThrough(new LineSplitStream(options));
}

export function joinLinesStream(
	input: ReadableStream<string>,
	options?: LineJoinStreamOptions,
): ReadableStream<string>;
export function joinLinesStream(
	input: Iterable<string> | AsyncIterable<string>,
	options?: LineJoinStreamOptions,
): ReadableStream<string>;
export function joinLinesStream(
	input: ReadableStream<string> | Iterable<string> | AsyncIterable<string>,
	options: LineJoinStreamOptions = {},
): ReadableStream<string> {
	return toReadableStream(input).pipeThrough(new LineJoinStream(options));
}
