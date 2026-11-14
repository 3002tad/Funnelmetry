# Evaluator comparison

Run `node test/performance/compare.mjs` from `workers/funnel-processor` with its
declared dependencies installed. `evaluator-before.js` is a test-only snapshot
from commit `663a2743e1e86985116c48c95bd2b6a33c5d2b51`; never import it in runtime
code or update it together with the optimized evaluator.

200 deterministic generated cases check deeply equal output and unchanged input,
including empty input, timestamp ties, wrong authority and repeated step pairs.
Four benchmark datasets also check equality. Each size uses three warmups, nine
samples and alternating execution order; small datasets batch multiple calls.
`results.json` preserves samples and medians. There is no flaky timing threshold.

This measures synthetic shuffled input on the local CPU, not DB/Kafka/network or
production throughput. Timestamp wrappers and maps add allocation overhead;
peak memory and already-sorted production workloads need separate measurement.
Run `node --test test/*.test.js` for worker tests. Database integration tests
require a dedicated `TEST_DATABASE_URL`.
