import { createByteQueue } from "../byte-queue";
import { toArrayBuffer } from "../shared/array-buffer";
import { throwError } from "../shared/error";
import { toU8Array } from "../shared/uint8array";
import {
	DEFAULT_MAX_IN_FLIGHT_RECORDS,
	HEADER_SIZE,
	type HeaderVersion,
	KEY_LENGTH,
	TAG_LENGTH,
} from "./constants";
import {
	assertMaxRecordSize,
	assertRecordSize,
	assertWritableRecordSize,
	createHeader,
	readHeader,
} from "./framing";
import {
	assertMaxInFlightRecords,
	OrderedRecordQueue,
} from "./ordered-record-queue";
import { RecordCipher } from "./record-cipher";

interface EncryptionTransformerOptions {
	recordSize: number;
	salt: Uint8Array;
	version: HeaderVersion;
	maxInFlightRecords: number;
}

interface DecryptionTransformerOptions {
	maxInFlightRecords: number;
	maxRecordSize: number;
}

export class EncryptionTransformer
	implements Transformer<Uint8Array, Uint8Array>
{
	#pending = createByteQueue();
	#sequence = 0;
	#recordSize: number;
	#payloadSize: number;
	#salt: ArrayBuffer;
	#header: Uint8Array;
	#version: HeaderVersion;
	#cipher: RecordCipher;
	#maxInFlightRecords: number;
	#records: OrderedRecordQueue<Uint8Array> | undefined;

	constructor(
		ikm: Uint8Array,
		{
			maxInFlightRecords,
			recordSize,
			salt,
			version,
		}: EncryptionTransformerOptions,
	) {
		assertWritableRecordSize(recordSize);
		assertMaxInFlightRecords(maxInFlightRecords);
		if (salt.byteLength !== KEY_LENGTH) {
			throwError(`Salt must be ${KEY_LENGTH} bytes`);
		}

		this.#recordSize = recordSize;
		this.#maxInFlightRecords = maxInFlightRecords;
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
		this.#records = new OrderedRecordQueue(
			this.#maxInFlightRecords,
			controller,
		);
		controller.enqueue(this.#header);
	}

	async transform(chunk: Uint8Array): Promise<void> {
		this.#pending.append(chunk);
		await this.#drain(false);
	}

	async flush(): Promise<void> {
		await this.#drain(true);
		await this.#getRecords().flush();
	}

	async #drain(isFinal: boolean): Promise<void> {
		while (this.#pending.byteLength > this.#payloadSize) {
			await this.#enqueueRecord(this.#payloadSize, false);
		}

		if (!isFinal) {
			return;
		}

		if (this.#pending.byteLength > 0) {
			await this.#enqueueRecord(this.#pending.byteLength, true);
		}
	}

	async #enqueueRecord(dataLength: number, isLast: boolean): Promise<void> {
		const paddedLength = isLast
			? dataLength + 1
			: this.#recordSize - TAG_LENGTH;
		const record = toU8Array(paddedLength);
		this.#pending.readInto(record.subarray(0, dataLength));
		record[dataLength] = isLast ? 2 : 1;
		const sequence = this.#sequence;
		this.#sequence++;
		await this.#getRecords().add(() =>
			this.#cipher.encryptRecord(record, sequence),
		);
	}

	#getRecords(): OrderedRecordQueue<Uint8Array> {
		if (!this.#records) {
			throwError("Encryption record queue is not initialized");
		}
		return this.#records;
	}
}

export class DecryptionTransformer
	implements Transformer<Uint8Array, Uint8Array>
{
	#pending = createByteQueue();
	#sequence = 0;
	#recordSize: number | undefined;
	#cipher: RecordCipher;
	#maxInFlightRecords: number;
	#maxRecordSize: number;
	#records: OrderedRecordQueue<Uint8Array> | undefined;

	constructor(
		ikm: Uint8Array,
		{
			maxInFlightRecords = DEFAULT_MAX_IN_FLIGHT_RECORDS,
			maxRecordSize,
		}: DecryptionTransformerOptions,
	) {
		assertMaxInFlightRecords(maxInFlightRecords);
		assertMaxRecordSize(maxRecordSize);
		this.#maxInFlightRecords = maxInFlightRecords;
		this.#maxRecordSize = maxRecordSize;
		this.#cipher = new RecordCipher(ikm);
	}

	start(controller: TransformStreamDefaultController<Uint8Array>): void {
		this.#records = new OrderedRecordQueue(
			this.#maxInFlightRecords,
			controller,
		);
	}

	async transform(chunk: Uint8Array): Promise<void> {
		this.#pending.append(chunk);
		await this.#drain(false);
	}

	async flush(): Promise<void> {
		await this.#drain(true);
		await this.#getRecords().flush();
	}

	async #drain(isFinal: boolean): Promise<void> {
		await this.#initializeFromHeader(isFinal);

		if (!this.#recordSize) {
			return;
		}

		while (this.#pending.byteLength > this.#recordSize) {
			await this.#enqueueRecord(this.#recordSize, false);
		}

		if (!isFinal) {
			return;
		}

		if (this.#pending.byteLength > 0) {
			await this.#enqueueRecord(this.#pending.byteLength, true);
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
		if (header.recordSize > this.#maxRecordSize) {
			throwError("Record size in header exceeds configured maximum");
		}
		this.#recordSize = header.recordSize;
		await this.#cipher.initialize(header.salt, header.version);
	}

	async #enqueueRecord(recordLength: number, isLast: boolean): Promise<void> {
		const record = this.#pending.read(recordLength);
		const sequence = this.#sequence;
		this.#sequence++;
		await this.#getRecords().add(() =>
			this.#cipher.decryptRecord(record, sequence, isLast),
		);
	}

	#getRecords(): OrderedRecordQueue<Uint8Array> {
		if (!this.#records) {
			throwError("Decryption record queue is not initialized");
		}
		return this.#records;
	}
}
