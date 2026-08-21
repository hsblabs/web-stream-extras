---
title: Encryption stream performance improvements
date: 2026-08-21
status: accepted
---

# Encryption stream performance improvements

## Goal

AES-GCM の wire format と既定の逐次実行を維持しながら、暗号ストリームの初回出力、コピー回数、スループットを改善する。

## Public interface

```ts
export interface EncryptionStreamOptions {
	recordSize?: number;
	salt?: Uint8Array;
	maxInFlightRecords?: number;
}

export interface DecryptionStreamOptions {
	maxInFlightRecords?: number;
	maxRecordSize?: number;
}
```

- `maxInFlightRecords` は正の整数だけを受け付け、既定値は `1` とする。
- `maxRecordSize` は復号ヘッダーを信用しないcaller向けの上限で、正の整数かつ有効なrecord sizeだけを受け付ける。
- `maxRecordSize` の既定値はuint32上限とし、既存の有効な暗号文を暗黙に拒否しない。
- `DecryptionStream`、`decryptStream()`、`webCryptoStream().decrypt()` は同じ復号optionを受け渡す。

## State transitions

### Encryption

1. `pending.byteLength > payloadSize` の間、先頭 `payloadSize` byteを非最終レコードとして確定する。
2. `pending.byteLength === payloadSize` なら、EOFまたは後続1byteを待つ。
3. EOFで残った `1..payloadSize` byteを最終レコードとして確定する。
4. 空入力はheaderだけを出力する。

### Decryption

1. headerを読み、record sizeとversionを検証してcipherを初期化する。
2. `pending.byteLength > recordSize` の間、先頭 `recordSize` byteを非最終レコードとして確定する。
3. `pending.byteLength === recordSize` なら、EOFまたは後続1byteを待つ。
4. EOFで残った `1..recordSize` byteを最終レコードとして確定する。

この状態機械では `lastRecordCandidate` を別bufferへ移さず、後続1byteが届いた時点で直前レコードを確定できる。

## Ordered bounded concurrency

- sequence numberは暗号処理を開始する前に単調増加で予約する。
- 各Web Crypto Promiseには開始時点で成功・失敗の両handlerを付け、遅い先行jobを待つ間のunhandled rejectionを防ぐ。
- 完了順にかかわらず、出力とエラーはrecord順に観測される。
- in-flight job数が上限に達したtransformだけが空きを待つ。
- job完了時のordered enqueueにより、上限未満でも次の入力chunkやEOFを待たず出力する。
- `flush()` は全jobのordered enqueueまたは最初のエラーを待つ。

## Copy policy

- `ByteQueue.read()` は先頭chunkが要求長以上なら`subarray()`を返す。
- `ByteQueue.readInto()` は暗号化用padding bufferへpayloadを直接移す。
- 非最終recordのpadding bufferは1回だけ確保し、delimiterとzero paddingを同じbufferに置く。
- Web Cryptoへ渡すviewは通常の`ArrayBuffer` backingならそのまま渡し、`SharedArrayBuffer` backingだけ安全な`ArrayBuffer` viewへ正規化する。
- 復号後はpayloadが平文bufferの半分以上なら`subarray()`を返し、それ未満なら保持メモリを抑えるため`slice()`する。
- current header versionのkey用HKDFとnonce用HKDFは並行導出する。legacy versionは従来の依存順を維持する。

## Invariants

- 同じkey、salt、record size、plaintextから生成されるciphertextは変更しない。
- ciphertext/plaintextの出力順序を変更しない。
- in-flight job数は設定値を超えない。
- 非最終recordは常に固定長、最終recordだけ固定長以下を許可する。
- 最初に確定したエラーでstreamを失敗させ、開始済みjobのrejectionを未処理にしない。

## Benchmark acceptance

benchmarkは暗号transformer外の最終連結を測定区間へ含めず、lazy sourceとcounting sinkを使う。

- record size: 64 KiB、1 MiB、4 MiB
- source chunk: 16 KiB、64 KiB、record payloadと同長、record payloadより1byte大きい
- max in-flight: 1、2、4
- metrics: throughput、最初のdata record出力時間、RSS/arrayBuffersの観測最大値、出力chunk数

1-byte caseはfragmentation stressとして64 KiB recordだけを別測定する。実行時間を制御するため小さいpayloadを使い、結果にpayload sizeを併記する。

## Acceptance tests

- 1byteの後続入力だけで暗号・復号の先行recordが出力される。
- concurrency 1/2/4でciphertextとround-trip結果が一致する。
- 後続jobが先に成功・失敗してもordered outputとerror処理を維持する。
- 不正なconcurrencyとrecord-size上限をconstructorで拒否する。
- headerのrecord sizeが`maxRecordSize`を超えた時点で、record本体を待たず拒否する。
- ByteQueueのpartial-read viewとreadIntoの境界・compactionを検証する。
- deterministic legacy/current ciphertext regressionを維持する。

## Non-goals

- wire format、header version、nonce derivationの変更
- 既定record sizeの変更
- `maxInFlightRecords > 1` の既定化
- runtime別の最適並列度の自動判定
