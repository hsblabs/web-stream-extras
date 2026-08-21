---
title: Encryption stream performance tickets
date: 2026-08-21
status: complete
---

# Encryption stream performance tickets

## Dependency graph

```text
T01 baseline benchmark
  -> T02 early finality + copy integration
    -> T03 ordered bounded concurrency + limits
      -> T04 residual copy + HKDF
        -> T05 benchmark matrix + documentation
```

## T01 Baseline benchmark

- [x] 壊れているdist importを修正する。
- [x] lazy sourceとcounting sinkで現行baselineを取得する。
- [x] `pnpm test` / `pnpm build` のbaselineを記録する。

## T02 Early finality and copy integration

Blocked by T01.

- [x] `lastRecordCandidate`をqueue上のstrict-greater-than判定へ置き換える。
- [x] `ByteQueue.read()`のpartial-view fast pathと`readInto()`を追加する。
- [x] encryption paddingを1allocation/1copyへ統合する。
- [x] 後続1byteでの先行出力とqueue境界をテストする。

## T03 Ordered bounded concurrency and limits

Blocked by T02.

- [x] ordered bounded record queueを暗号・復号で共有する。
- [x] `maxInFlightRecords`を既定1で公開する。
- [x] `maxRecordSize`を復号optionとして公開する。
- [x] concurrency、順序、validation、header早期拒否をテストする。

## T04 Residual copy and HKDF

Blocked by T03.

- [x] Web Cryptoへ通常のArrayBuffer-backed viewを直接渡す。
- [x] `removePadding()`を保持率付きviewへ変更する。
- [x] current versionの独立HKDFを並行化する。
- [x] legacy/current deterministic regressionを再確認する。

## T05 Benchmark matrix and documentation

Blocked by T04.

- [x] record size/chunk size/concurrency matrixを追加する。
- [x] throughput/TTFB/RSS/arrayBuffers/chunk countを出力する。
- [x] README、TODO、LESSONSを更新する。
- [x] lint/typecheck/test/build/benchを実行する。
- [x] scoped commitを作成する。
