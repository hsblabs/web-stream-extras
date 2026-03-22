import { throwError } from "../shared/error";

export function encodeCOBS(input: Uint8Array): Uint8Array {
	const output: number[] = [];
	let codeIndex = 0;
	let code = 1;

	output.push(0);

	for (const value of input) {
		if (value === 0) {
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
}

export function decodeCOBS(input: Uint8Array): Uint8Array {
	if (input.byteLength === 0) {
		throwError("COBS payload must not be empty");
	}

	const output: number[] = [];
	let offset = 0;

	while (offset < input.byteLength) {
		const code = input[offset];
		if (code === 0) {
			throwError("COBS code byte must be non-zero");
		}

		offset++;
		const blockEnd = offset + code - 1;

		if (blockEnd > input.byteLength) {
			throwError("COBS payload is truncated");
		}

		while (offset < blockEnd) {
			const value = input[offset];
			if (value === 0) {
				throwError("COBS data byte must be non-zero");
			}

			output.push(value);
			offset++;
		}

		if (code !== 0xff && offset < input.byteLength) {
			output.push(0);
		}
	}

	return Uint8Array.from(output);
}
