import { isError } from "../shared/is";

export type JSONLInputChunk = string | Uint8Array;

export interface JSONLParseStreamOptions {
	reviver?: Parameters<typeof JSON.parse>[1];
	ignoreEmptyLines?: boolean;
	maxLineChars?: number;
	fatal?: boolean;
}

export class JSONLParseError extends SyntaxError {
	readonly lineNumber: number;
	readonly line: string;

	constructor({
		lineNumber,
		line,
		cause,
	}: {
		lineNumber: number;
		line: string;
		cause: unknown;
	}) {
		const causeMessage = isError(cause) ? cause.message : String(cause);

		super(`Invalid JSONL at line ${lineNumber}: ${causeMessage}`, {
			cause,
		});

		this.name = "JSONLParseError";
		this.lineNumber = lineNumber;
		this.line = line;
	}
}

export class JSONLParseStream<T = unknown> extends TransformStream<
	JSONLInputChunk,
	T
> {
	constructor(options: JSONLParseStreamOptions = {}) {
		const decoder = new TextDecoder("utf-8", {
			fatal: options.fatal ?? false,
		});
		const ignoreEmptyLines = options.ignoreEmptyLines ?? false;
		const maxLineChars = options.maxLineChars;

		let buffer = "";
		let lineNumber = 0;

		const assertLineSize = (line: string): void => {
			if (maxLineChars !== undefined && line.length > maxLineChars) {
				throw new RangeError(
					`JSONL line exceeded maxLineChars: ${line.length} > ${maxLineChars}`,
				);
			}
		};

		const parseLine = (
			rawLine: string,
			controller: TransformStreamDefaultController<T>,
		): void => {
			lineNumber += 1;

			const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

			assertLineSize(line);

			if (line === "") {
				if (ignoreEmptyLines) {
					return;
				}

				throw new JSONLParseError({
					lineNumber,
					line,
					cause: new SyntaxError("Empty line is not valid JSONL"),
				});
			}

			try {
				controller.enqueue(JSON.parse(line, options.reviver) as T);
			} catch (cause) {
				throw new JSONLParseError({
					lineNumber,
					line,
					cause,
				});
			}
		};

		const decodeChunk = (chunk: JSONLInputChunk): string => {
			if (typeof chunk === "string") {
				return chunk;
			}

			return decoder.decode(chunk, { stream: true });
		};

		super({
			transform(chunk, controller) {
				buffer += decodeChunk(chunk);

				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				assertLineSize(buffer);

				for (const line of lines) {
					parseLine(line, controller);
				}
			},

			flush(controller) {
				buffer += decoder.decode();
				assertLineSize(buffer);

				if (buffer !== "") {
					parseLine(buffer, controller);
				}
			},
		});
	}
}

export function parseJSONLStream<T = unknown>(
	input: ReadableStream<JSONLInputChunk>,
	options?: JSONLParseStreamOptions,
): ReadableStream<T> {
	return input.pipeThrough(new JSONLParseStream<T>(options));
}
