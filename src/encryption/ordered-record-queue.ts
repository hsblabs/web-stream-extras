import { throwError } from "../shared/error";

type SettledRecord<T> = { ok: true; value: T } | { ok: false; error: unknown };

interface RecordOutput<T> {
	enqueue(value: T): void;
	error(reason: unknown): void;
}

interface CapacityWaiter {
	resolve(): void;
	reject(reason: unknown): void;
}

const NO_FAILURE = Symbol("no failure");

export function assertMaxInFlightRecords(value: number): void {
	if (!Number.isInteger(value) || value < 1) {
		throwError("Maximum in-flight records must be a positive integer");
	}
}

export class OrderedRecordQueue<T> {
	#activeCount = 0;
	#capacityWaiters: CapacityWaiter[] = [];
	#failure: unknown | typeof NO_FAILURE = NO_FAILURE;
	#tail = Promise.resolve();
	#maxInFlightRecords: number;
	#output: RecordOutput<T>;

	constructor(maxInFlightRecords: number, output: RecordOutput<T>) {
		assertMaxInFlightRecords(maxInFlightRecords);
		this.#maxInFlightRecords = maxInFlightRecords;
		this.#output = output;
	}

	async add(startJob: () => Promise<T>): Promise<void> {
		this.#throwIfFailed();
		this.#activeCount++;
		let job: Promise<T>;
		try {
			job = startJob();
		} catch (error) {
			this.#activeCount--;
			this.#fail(error);
			this.#settleCapacityWaiters();
			throw error;
		}
		const settled = job.then<SettledRecord<T>, SettledRecord<T>>(
			(value) => ({ ok: true, value }),
			(error: unknown) => ({ ok: false, error }),
		);
		const emission = this.#tail.then(async () => {
			if (this.#failure !== NO_FAILURE) return;
			const result = await settled;
			if (!result.ok) {
				throw result.error;
			}
			this.#output.enqueue(result.value);
		});
		this.#tail = emission
			.catch((error: unknown) => {
				this.#fail(error);
			})
			.finally(() => {
				this.#activeCount--;
				this.#settleCapacityWaiters();
			});

		if (this.#activeCount >= this.#maxInFlightRecords) {
			await this.#waitForCapacity();
		}
		this.#throwIfFailed();
	}

	async flush(): Promise<void> {
		await this.#tail;
		this.#throwIfFailed();
	}

	#fail(error: unknown): void {
		if (this.#failure !== NO_FAILURE) return;
		this.#failure = error;
		try {
			this.#output.error(error);
		} catch {}
	}

	#settleCapacityWaiters(): void {
		if (
			this.#failure === NO_FAILURE &&
			this.#activeCount >= this.#maxInFlightRecords
		) {
			return;
		}

		const waiters = this.#capacityWaiters.splice(0);
		for (const waiter of waiters) {
			if (this.#failure === NO_FAILURE) {
				waiter.resolve();
			} else {
				waiter.reject(this.#failure);
			}
		}
	}

	#throwIfFailed(): void {
		if (this.#failure !== NO_FAILURE) {
			throw this.#failure;
		}
	}

	#waitForCapacity(): Promise<void> {
		if (this.#activeCount < this.#maxInFlightRecords) {
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			this.#capacityWaiters.push({ reject, resolve });
		});
	}
}
