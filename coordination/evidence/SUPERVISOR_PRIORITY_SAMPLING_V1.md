# Supervisor Priority Sampling V1

Source base: `b3e9a8e168f63b179ab3211dc1c4c2747d628c6c`

Failure mode: supervisor continuity was observed only after sequential CAPTURE fanout across the entire fleet. At larger fleet sizes this made the nominal 2-second continuity cycle O(N) and allowed worker observation latency to starve the authoritative supervisor tab.

Branch-local fix:
- observe supervisor tab before any fleet worker capture;
- bound worker capture sampling to a rotating sample (default 4, maximum 8);
- retain last trusted generation observation for workers not sampled on the current cycle;
- propagate terminal lifecycle state without requiring capture;
- preserve page/model text zero authority and existing ambiguous-effect fencing.

This branch does not change production or release refs until its dedicated CI gate is green.
