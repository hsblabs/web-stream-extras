import { describe, expect, it } from "vitest";
import * as cobsApi from "./cobs";
import {
	createCOBSDecoderStream,
	createCOBSEncoderStream,
	decodeCOBSFrame,
	encodeCOBSFrame,
	readCOBS,
	writeCOBS,
} from "./cobs";
import { readAllBytes, readAllChunks, readableFromChunks } from "./shared";

describe("cobs public API", () => {
	it("exports the supported cobs helpers", () => {
		expect(Object.keys(cobsApi).sort()).toEqual([
			"createCOBSDecoderStream",
			"createCOBSEncoderStream",
			"decodeCOBSFrame",
			"encodeCOBSFrame",
			"readCOBS",
			"writeCOBS",
		]);
	});
});

describe("cobs", () => {
	it("round-trips a raw frame with embedded zero bytes", () => {
		const raw = Uint8Array.of(0x11, 0x22, 0x00, 0x33);

		expect(decodeCOBSFrame(encodeCOBSFrame(raw))).toEqual(raw);
	});

	it("encodes each incoming chunk as a delimiter-terminated frame", async () => {
		const encoded = await readAllChunks(
			readableFromChunks([
				Uint8Array.of(0x01, 0x02, 0x00),
				Uint8Array.of(0xff, 0xee),
			]).pipeThrough(createCOBSEncoderStream()),
		);

		expect(encoded).toEqual([
			Uint8Array.of(0x03, 0x01, 0x02, 0x01, 0x00),
			Uint8Array.of(0x03, 0xff, 0xee, 0x00),
		]);
	});

	it("decodes delimiter-separated frames across arbitrary chunk boundaries", async () => {
		const decoded = await readAllChunks(
			readableFromChunks([
				Uint8Array.of(0x03, 0x11),
				Uint8Array.of(0x22, 0x02, 0x33, 0x00, 0x01, 0x00),
			]).pipeThrough(createCOBSDecoderStream()),
		);

		expect(decoded).toEqual([
			Uint8Array.of(0x11, 0x22, 0x00, 0x33),
			new Uint8Array(0),
		]);
	});

	it("exposes readCOBS as a decoding convenience", async () => {
		const decoded = await readAllChunks(
			readCOBS(
				readableFromChunks([
					Uint8Array.of(0x03, 0x11, 0x22),
					Uint8Array.of(0x02, 0x33, 0x00),
				]),
			),
		);

		expect(decoded).toEqual([Uint8Array.of(0x11, 0x22, 0x00, 0x33)]);
	});

	it("exposes writeCOBS as an encoding convenience", async () => {
		const written: Uint8Array[] = [];
		const sink = new WritableStream<Uint8Array>({
			write(chunk) {
				written.push(chunk.slice());
			},
		});
		const writer = writeCOBS(sink).getWriter();

		await writer.write(Uint8Array.of(0x11, 0x22, 0x00, 0x33));
		await writer.write(new Uint8Array(0));
		await writer.close();

		await expect(readAllBytes(readableFromChunks(written))).resolves.toEqual(
			Uint8Array.of(0x03, 0x11, 0x22, 0x02, 0x33, 0x00, 0x01, 0x00),
		);
	});

	it("rejects unterminated frames at the end of the stream", async () => {
		await expect(
			readAllChunks(
				readableFromChunks(Uint8Array.of(0x03, 0x11, 0x22)).pipeThrough(
					createCOBSDecoderStream(),
				),
			),
		).rejects.toThrow();
	});
});
