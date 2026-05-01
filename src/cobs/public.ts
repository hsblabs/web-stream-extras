import { createByteQueue } from "../byte-queue";
import { throwError } from "../shared/error";

const COBS_DELIMITER = 0x00;

const withDelimiter = (encodedFrame: Uint8Array): Uint8Array => {
	const result = new Uint8Array(encodedFrame.byteLength + 1);
	result.set(encodedFrame, 0);
	result[encodedFrame.byteLength] = COBS_DELIMITER;
	return result;
};

export const encodeCOBSFrame = (frame: Uint8Array): Uint8Array => {
	const output: number[] = [0];
	let codeIndex = 0;
	let code = 1;

	for (const value of frame) {
		if (value === COBS_DELIMITER) {
			output[codeIndex] = code;
			codeIndex = output.length;
			output.push(0);
			code = 1;
			continue;
		}

		output.push(value);
		code++;

		if (code === 0xff) {
			output[codeIndex] = code;
			codeIndex = output.length;
			output.push(0);
			code = 1;
		}
	}

	output[codeIndex] = code;
	return Uint8Array.from(output);
};

export const decodeCOBSFrame = (encodedFrame: Uint8Array): Uint8Array => {
	if (encodedFrame.byteLength === 0) {
		throwError("Invalid COBS frame: empty encoded payload.");
	}

	const output: number[] = [];
	let index = 0;

	while (index < encodedFrame.byteLength) {
		const code = encodedFrame[index];
		if (code === COBS_DELIMITER) {
			throwError("Invalid COBS frame: code byte must not be 0x00.");
		}

		const next = index + 1;
		const endExclusive = next + (code - 1);

		if (endExclusive > encodedFrame.byteLength) {
			throwError("Invalid COBS frame: truncated block.");
		}

		for (let cursor = next; cursor < endExclusive; cursor++) {
			output.push(encodedFrame[cursor] ?? 0);
		}

		index = endExclusive;

		if (code !== 0xff && index < encodedFrame.byteLength) {
			output.push(COBS_DELIMITER);
		}
	}

	return Uint8Array.from(output);
};

export const createCOBSEncoderStream = (): TransformStream<
	Uint8Array,
	Uint8Array
> =>
	new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			controller.enqueue(withDelimiter(encodeCOBSFrame(chunk)));
		},
	});

export const createCOBSDecoderStream = (): TransformStream<
	Uint8Array,
	Uint8Array
> => {
	const buffer = createByteQueue();

	return new TransformStream<Uint8Array, Uint8Array>({
		flush() {
			if (buffer.byteLength !== 0) {
				throwError("Invalid COBS stream: unterminated frame at end of stream.");
			}
		},
		transform(chunk, controller) {
			buffer.append(chunk);

			while (true) {
				const delimiterIndex = buffer.indexOf(COBS_DELIMITER);
				if (delimiterIndex === -1) {
					return;
				}

				const frame = buffer.read(delimiterIndex);
				buffer.discard(1);
				controller.enqueue(decodeCOBSFrame(frame));
			}
		},
	});
};

export const readCOBS = (
	source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> => source.pipeThrough(createCOBSDecoderStream());

export const writeCOBS = (
	sink: WritableStream<Uint8Array>,
): WritableStream<Uint8Array> => {
	const writer = sink.getWriter();

	return new WritableStream<Uint8Array>({
		abort(reason) {
			return writer.abort(reason);
		},
		close() {
			return writer.close();
		},
		write(chunk) {
			return writer.write(withDelimiter(encodeCOBSFrame(chunk)));
		},
	});
};
