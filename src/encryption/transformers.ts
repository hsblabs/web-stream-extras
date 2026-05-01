import { createByteQueue } from "../byte-queue";
import { toArrayBuffer } from "../shared/array-buffer";
import { throwError } from "../shared/error";
import { toU8Array } from "../shared/uint8array";
import {
	HEADER_SIZE,
	type HeaderVersion,
	KEY_LENGTH,
	TAG_LENGTH,
} from "./constants";
import {
	assertRecordSize,
	assertWritableRecordSize,
	createHeader,
	readHeader,
} from "./framing";
import { RecordCipher } from "./record-cipher";

interface EncryptionTransformerOptions {
	recordSize: number;
	salt: Uint8Array;
	version: HeaderVersion;
}

export class EncryptionTransformer
	implements Transformer<Uint8Array, Uint8Array> {
	#pending = createByteQueue();
	#lastRecordCandidate: Uint8Array | undefined;
	#sequence = 0;
	#recordSize: number;
	#payloadSize: number;
	#salt: ArrayBuffer;
	#header: Uint8Array;
	#version: HeaderVersion;
	#cipher: RecordCipher;

	constructor(
		ikm: Uint8Array,
		{ recordSize, salt, version }: EncryptionTransformerOptions,
	) {
		assertWritableRecordSize(recordSize);
		if (salt.byteLength !== KEY_LENGTH) {
			throwError(`Salt must be ${KEY_LENGTH} bytes`);
		}

		this.#recordSize = recordSize;
		this.#payloadSize = recordSize - TAG_LENGTH - 1;
		this.#salt = toArrayBuffer(salt);
		this.#version = version;
		this.#header = createHeader(
			toU8Array(this.#salt),
			recordSize,
			this.#version,
		);
		this.#cipher = new RecordCipher(ikm);
	}

	async start(
		controller: TransformStreamDefaultController<Uint8Array>,
	): Promise<void> {
		await this.#cipher.initialize(this.#salt, this.#version);
		controller.enqueue(this.#header);
	}

	async transform(
		chunk: Uint8Array,
		controller: TransformStreamDefaultController<Uint8Array>,
	): Promise<void> {
		this.#pending.append(chunk);
		await this.#drain(false, controller);
	}

	async flush(
		controller: TransformStreamDefaultController<Uint8Array>,
	): Promise<void> {
		await this.#drain(true, controller);
	}

	async #drain(
		isFinal: boolean,
		controller: TransformStreamDefaultController<Uint8Array>,
	): Promise<void> {
		while (this.#pending.byteLength >= this.#payloadSize) {
			const record = this.#pending.read(this.#payloadSize);
			if (this.#lastRecordCandidate) {
				await this.#enqueueRecord(this.#lastRecordCandidate, false, controller);
			}
			this.#lastRecordCandidate = record;
		}

		if (!isFinal) {
			return;
		}

		if (this.#pending.byteLength > 0) {
			if (this.#lastRecordCandidate) {
				await this.#enqueueRecord(this.#lastRecordCandidate, false, controller);
			}
			this.#lastRecordCandidate = this.#pending.read(this.#pending.byteLength);
		}

		if (this.#lastRecordCandidate) {
			await this.#enqueueRecord(this.#lastRecordCandidate, true, controller);
			this.#lastRecordCandidate = undefined;
		}
	}

	async #enqueueRecord(
		record: Uint8Array,
		isLast: boolean,
		controller: TransformStreamDefaultController<Uint8Array>,
	): Promise<void> {
		controller.enqueue(
			await this.#cipher.encryptRecord(
				record,
				this.#sequence,
				this.#recordSize,
				isLast,
			),
		);
		this.#sequence++;
	}
}

export class DecryptionTransformer
	implements Transformer<Uint8Array, Uint8Array> {
	#pending = createByteQueue();
	#lastRecordCandidate: Uint8Array | undefined;
	#sequence = 0;
	#recordSize: number | undefined;
	#cipher: RecordCipher;

	constructor(ikm: Uint8Array) {
		this.#cipher = new RecordCipher(ikm);
	}

	async transform(
		chunk: Uint8Array,
		controller: TransformStreamDefaultController<Uint8Array>,
	): Promise<void> {
		this.#pending.append(chunk);
		await this.#drain(false, controller);
	}

	async flush(
		controller: TransformStreamDefaultController<Uint8Array>,
	): Promise<void> {
		await this.#drain(true, controller);
	}

	async #drain(
		isFinal: boolean,
		controller: TransformStreamDefaultController<Uint8Array>,
	): Promise<void> {
		await this.#initializeFromHeader(isFinal);

		if (!this.#recordSize) {
			return;
		}

		while (this.#pending.byteLength >= this.#recordSize) {
			const record = this.#pending.read(this.#recordSize);
			if (this.#lastRecordCandidate) {
				await this.#enqueueRecord(this.#lastRecordCandidate, false, controller);
			}
			this.#lastRecordCandidate = record;
		}

		if (!isFinal) {
			return;
		}

		if (this.#pending.byteLength > 0) {
			if (this.#lastRecordCandidate) {
				await this.#enqueueRecord(this.#lastRecordCandidate, false, controller);
			}
			this.#lastRecordCandidate = this.#pending.read(this.#pending.byteLength);
		}

		if (this.#lastRecordCandidate) {
			await this.#enqueueRecord(this.#lastRecordCandidate, true, controller);
			this.#lastRecordCandidate = undefined;
		}
	}

	async #initializeFromHeader(isFinal: boolean): Promise<void> {
		if (this.#recordSize) {
			return;
		}
		if (this.#pending.byteLength === 0) {
			return;
		}
		if (this.#pending.byteLength < HEADER_SIZE) {
			if (isFinal) {
				throwError("Chunk too small for reading header");
			}
			return;
		}

		const header = readHeader(this.#pending.read(HEADER_SIZE));
		assertRecordSize(header.recordSize, "Record size in header is too small");
		this.#recordSize = header.recordSize;
		await this.#cipher.initialize(header.salt, header.version);
	}

	async #enqueueRecord(
		record: Uint8Array,
		isLast: boolean,
		controller: TransformStreamDefaultController<Uint8Array>,
	): Promise<void> {
		controller.enqueue(
			await this.#cipher.decryptRecord(record, this.#sequence, isLast),
		);
		this.#sequence++;
	}
}
