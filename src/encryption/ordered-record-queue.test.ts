import { describe, expect, it } from "vitest";
import { OrderedRecordQueue } from "./ordered-record-queue";

interface Deferred<T> {
	promise: Promise<T>;
	reject(reason: unknown): void;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let resolve: Deferred<T>["resolve"] = () => {};
	let reject: Deferred<T>["reject"] = () => {};
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

function createOutput<T>(): {
	errors: unknown[];
	output: { enqueue(value: T): void; error(reason: unknown): void };
	values: T[];
} {
	const errors: unknown[] = [];
	const values: T[] = [];
	return {
		errors,
		output: {
			enqueue(value) {
				values.push(value);
			},
			error(reason) {
				errors.push(reason);
			},
		},
		values,
	};
}

describe("OrderedRecordQueue", () => {
	it("emits a completed job without waiting for another job or flush", async () => {
		const { output, values } = createOutput<number>();
		const queue = new OrderedRecordQueue(2, output);
		const job = deferred<number>();

		await queue.add(() => job.promise);
		job.resolve(1);
		await queue.flush();

		expect(values).toEqual([1]);
	});

	it("emits records in schedule order", async () => {
		const { output, values } = createOutput<number>();
		const queue = new OrderedRecordQueue(2, output);
		const first = deferred<number>();
		const second = deferred<number>();

		await queue.add(() => first.promise);
		const capacity = queue.add(() => second.promise);
		second.resolve(2);
		expect(values).toEqual([]);
		first.resolve(1);
		await capacity;
		await queue.flush();

		expect(values).toEqual([1, 2]);
	});

	it("reports a later rejection only after prior output", async () => {
		const { errors, output, values } = createOutput<number>();
		const queue = new OrderedRecordQueue(2, output);
		const first = deferred<number>();
		const second = deferred<number>();
		const failure = new Error("second record failed");

		await queue.add(() => first.promise);
		const capacity = queue.add(() => second.promise);
		second.reject(failure);
		first.resolve(1);
		await capacity;
		await expect(queue.flush()).rejects.toBe(failure);

		expect(values).toEqual([1]);
		expect(errors).toEqual([failure]);
	});

	it("does not start new jobs after a failure", async () => {
		const { output } = createOutput<number>();
		const queue = new OrderedRecordQueue(2, output);
		const failure = new Error("first record failed");
		let laterJobStarted = false;

		await queue.add(() => Promise.reject(failure));
		await expect(queue.flush()).rejects.toBe(failure);
		await expect(
			queue.add(() => {
				laterJobStarted = true;
				return Promise.resolve(2);
			}),
		).rejects.toBe(failure);

		expect(laterJobStarted).toBe(false);
	});

	it("rejects invalid concurrency limits", () => {
		const { output } = createOutput<number>();
		for (const value of [0, -1, 1.5]) {
			expect(() => new OrderedRecordQueue(value, output)).toThrow();
		}
	});
});
