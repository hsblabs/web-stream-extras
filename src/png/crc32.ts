const CRC32_TABLE = (() => {
	const table = new Uint32Array(256);

	for (let index = 0; index < table.length; index++) {
		let value = index;

		for (let bit = 0; bit < 8; bit++) {
			value = (value & 1) === 0 ? value >>> 1 : (value >>> 1) ^ 0xedb8_8320;
		}

		table[index] = value >>> 0;
	}

	return table;
})();

export function crc32(input: Uint8Array): number {
	let value = 0xffff_ffff;

	for (const byte of input) {
		value = (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
	}

	return (value ^ 0xffff_ffff) >>> 0;
}
