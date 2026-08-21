---
title: Ordered bounded concurrency for encryption records
date: 2026-08-21
status: accepted
agent: GPT-5 Codex
---

# Ordered bounded concurrency for encryption records

## Context

各recordはsequence numberから固有nonceを導出するため、AES-GCM処理は独立して開始できる。一方、公開streamはrecord順の出力、bounded memory、予測可能なエラー伝播を維持する必要がある。`TransformStream`の`transform()`で暗号Promiseを直接待つ実装は、入力chunkごとの処理を完全に直列化していた。

## Decision

暗号・復号transformerの内部に、ordered outputを担当する単一のbounded queueを置く。

- sequence numberはjob開始前に予約する。
- Web Crypto Promiseは開始時にsettled valueへ変換する。
- jobは並行実行し、controllerへのenqueueだけをFIFO順にする。
- job完了時にenqueueし、次の入力chunkや`flush()`まで結果を不要に保持しない。
- 上限に達したtransformだけがFIFO先頭の完了による空きを待つ。
- 既定上限は1とし、並列化はopt-inにする。

## Consequences

- wire formatとdeterministic ciphertextを維持したまま並列化できる。
- concurrency 2以上ではWeb Crypto内部snapshotと出力bufferの一時メモリが増える。
- runtimeごとに最適値が異なるため、自動選択は行わない。
- 非同期enqueue、stream error、flushの競合を内部queueのテストsurfaceへ集約する。

