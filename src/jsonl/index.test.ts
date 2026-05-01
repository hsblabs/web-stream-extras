import { describe, expect, it } from "vitest";
import {
	binaryToString,
	readAllBytes,
	readAllChunks,
	readableFromChunks,
	stringToBinary,
} from "../shared";
import {
	encodeJSONLStream,
	JSONLEncodeStream,
	JSONLParseError,
	JSONLParseStream,
	JSONLStringifyStream,
	parseJSONLStream,
	stringifyJSONLStream,
} from "./index";

type Event = {
	id: string;
	type: string;
};

describe("jsonl", () => {
	it("encodes values to UTF-8 JSON lines", async () => {
		const source = readableFromChunks<Event>([
			{ id: "evt_1", type: "created" },
			{ id: "evt_2", type: "updated" },
		]);

		const encoded = await readAllBytes(
			source.pipeThrough(new JSONLEncodeStream<Event>()),
		);

		expect(binaryToString(encoded)).toBe(
			'{"id":"evt_1","type":"created"}\n{"id":"evt_2","type":"updated"}\n',
		);
	});

	it("stringifies values to JSON line strings", async () => {
		const source = readableFromChunks<Event>({ id: "evt_1", type: "created" });

		await expect(
			readAllChunks(source.pipeThrough(new JSONLStringifyStream<Event>())),
		).resolves.toEqual(['{"id":"evt_1","type":"created"}\n']);
	});

	it("rejects values that cannot be represented as JSON lines", async () => {
		const source = readableFromChunks<undefined>(undefined);

		await expect(
			readAllChunks(source.pipeThrough(new JSONLStringifyStream())),
		).rejects.toThrow(TypeError);
	});

	it("parses string chunks split across JSON lines", async () => {
		const parsed = await readAllChunks(
			readableFromChunks([
				'{"id":"evt_1"',
				',"type":"created"}\n',
				"42",
			]).pipeThrough(new JSONLParseStream<Event | number>()),
		);

		expect(parsed).toEqual([{ id: "evt_1", type: "created" }, 42]);
	});

	it("parses UTF-8 byte chunks split inside a multibyte character", async () => {
		const encoded = stringToBinary('{"message":"こんにちは"}\n');
		const chunks = [encoded.slice(0, 14), encoded.slice(14)];

		const parsed = await readAllChunks(
			readableFromChunks(chunks).pipeThrough(
				new JSONLParseStream<{ message: string }>(),
			),
		);

		expect(parsed).toEqual([{ message: "こんにちは" }]);
	});

	it("reports JSON parse errors with line details", async () => {
		const stream = parseJSONLStream(readableFromChunks('{"ok":true}\nnope\n'));

		await expect(readAllChunks(stream)).rejects.toMatchObject({
			name: "JSONLParseError",
			lineNumber: 2,
			line: "nope",
		});
	});

	it("can ignore empty lines when parsing", async () => {
		const parsed = await readAllChunks(
			parseJSONLStream(readableFromChunks('\n{"ok":true}\n'), {
				ignoreEmptyLines: true,
			}),
		);

		expect(parsed).toEqual([{ ok: true }]);
	});

	it("rejects empty lines by default", async () => {
		await expect(
			readAllChunks(parseJSONLStream(readableFromChunks("\n"))),
		).rejects.toBeInstanceOf(JSONLParseError);
	});

	it("enforces maxLineChars while buffering", async () => {
		await expect(
			readAllChunks(
				parseJSONLStream(readableFromChunks('{"too":"long"}'), {
					maxLineChars: 5,
				}),
			),
		).rejects.toThrow(RangeError);
	});

	it("applies maxLineChars per line instead of per chunk", async () => {
		const parsed = await readAllChunks(
			parseJSONLStream(readableFromChunks("1\n2\n3\n4\n"), {
				maxLineChars: 1,
			}),
		);

		expect(parsed).toEqual([1, 2, 3, 4]);
	});

	it("creates string streams from iterables", async () => {
		const stream = stringifyJSONLStream([{ id: "evt_1", type: "created" }]);

		await expect(readAllChunks(stream)).resolves.toEqual([
			'{"id":"evt_1","type":"created"}\n',
		]);
	});

	it("creates encoded streams from async iterables", async () => {
		async function* events(): AsyncGenerator<Event> {
			yield { id: "evt_1", type: "created" };
			yield { id: "evt_2", type: "updated" };
		}

		const encoded = await readAllBytes(encodeJSONLStream(events()));

		expect(binaryToString(encoded)).toBe(
			'{"id":"evt_1","type":"created"}\n{"id":"evt_2","type":"updated"}\n',
		);
	});
});
