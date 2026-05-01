import { describe, expect, it } from "vitest";
import {
	binaryToString,
	readAllBytes,
	readAllChunks,
	readableFromChunks,
	stringToBinary,
} from "../shared";
import {
	decodeTextStream,
	encodeTextStream,
	LineJoinStream,
	LineSplitStream,
	splitLinesStream,
	TextDecodeStream,
	TextEncodeStream,
} from "./index";

describe("text", () => {
	it("decodes UTF-8 chunks split inside a multibyte character", async () => {
		const encoded = stringToBinary("hello こんにちは");
		const chunks = [encoded.slice(0, 8), encoded.slice(8)];

		await expect(
			readAllChunks(
				readableFromChunks(chunks).pipeThrough(new TextDecodeStream()),
			),
		).resolves.toEqual(["hello ", "こんにちは"]);
	});

	it("passes through string chunks when decoding mixed text input", async () => {
		const decoded = await readAllChunks(
			decodeTextStream(
				readableFromChunks(["hello ", stringToBinary("world"), "!"]),
			),
		);

		expect(decoded).toEqual(["hello ", "world", "!"]);
	});

	it("encodes string chunks to UTF-8 bytes", async () => {
		const encoded = await readAllBytes(
			readableFromChunks(["hello ", "世界"]).pipeThrough(
				new TextEncodeStream(),
			),
		);

		expect(binaryToString(encoded)).toBe("hello 世界");
	});

	it("creates encoded streams from iterables", async () => {
		const encoded = await readAllBytes(encodeTextStream(["a", "b", "c"]));

		expect(binaryToString(encoded)).toBe("abc");
	});

	it("splits lines across mixed string and byte chunks", async () => {
		const lines = await readAllChunks(
			readableFromChunks([
				"alpha\nbe",
				stringToBinary("ta\r\n"),
				"gamma",
			]).pipeThrough(new LineSplitStream()),
		);

		expect(lines).toEqual(["alpha", "beta", "gamma"]);
	});

	it("can keep line endings when splitting lines", async () => {
		const lines = await readAllChunks(
			splitLinesStream(readableFromChunks("alpha\nbeta\r\ngamma"), {
				keepLineBreaks: true,
			}),
		);

		expect(lines).toEqual(["alpha\n", "beta\r\n", "gamma"]);
	});

	it("enforces maxLineChars while buffering", async () => {
		await expect(
			readAllChunks(
				splitLinesStream(readableFromChunks("too-long"), {
					maxLineChars: 3,
				}),
			),
		).rejects.toThrow(RangeError);
	});

	it("joins lines with the requested line ending", async () => {
		const joined = await readAllChunks(
			readableFromChunks(["alpha", "beta"]).pipeThrough(
				new LineJoinStream({ lineBreak: "\r\n" }),
			),
		);

		expect(joined).toEqual(["alpha\r\n", "beta\r\n"]);
	});
});
