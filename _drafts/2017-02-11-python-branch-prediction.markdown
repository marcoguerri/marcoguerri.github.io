---
layout: post
title:  "How branch prediction affects performance"
date:   2017-02-11 08:00:00
published: yes
categories: performance python
pygments: true
summary: "Recent CPU  microarchitectures have drastically improved the accuracy
of hardware branch predictors. Some heavily non-linear workloads significantly 
benefit from a lower rate of mispredicted branches: here I provide an example based 
on CPython."
---

Introduction
=======

I was recently analyzing the performance of [DIRACBenchmark](https://github.com/DIRACGrid/DB12/blob/master/DIRACbenchmark.py)
after having seen a peculiar speed-up in the transition from Sandry Bridge/Ivy Bridge
architecture to Haswell/Broadwell. This benchmark basically generates a long
sequence of random numbers via Python random module and performs some 
multiply and accumulate operations. What stood out after some initial
tests was a 50% improvement in runtime when switching from Xeon v2 to Xeon v3
processors. All the other benchmarks I was familiar with were showing a difference
that was in the range 10%-20%, but this Python script was definitely 
an outlier.


Systems under test
=======
I was comparing the performance on the following two systems:

|| Ivy Bridge | Haswell |
|----------|--------------------------------|-------------------|
| CPU      | Dual socket E5-2650v2 @ 2.60 GHz | Dual socket E5-2640v3 @ 2.60 GHz |
| CPU details      | 8 physical cores, 16 threads, 2.8GHz Turbo CLK  | 8 physical cores, 10 threads, 3.4 GHz Turbo CLK |
| RAM      | 64 GiB DD3, fully balanced NUMA domains  | 128 GiB DDR4, fully balanced NUMA domains|
| OS     | SLC 6.8 running kernel 2.6.32-642  | SLC 6.8 running kernel 2.6.32-642 |
| gcc    | 4.4.7| 4.4.7 |


The clock frequency had been set to 2.00GHz via userspace governor with *acpi_cpufreq*
driver. Disregarding for a moment the output of the benchmark, which is not 
relevant, the runtime on the two platforms was the following:

```
[root@ivybridge ~]# time numactl --physcpubind=0 --membind=0 python lhcb.py 
7.89889415482
real    1m3.505s
user    1m3.272s
sys 0m0.215s

[root@haswell ~]# time numactl --physcpubind=0 --membind=0 python lhcb.py 
[to be defined]
real    1m3.505s
user    1m3.272s
sys 0m0.215s
```

A difference of around 50%. I was sure the software running on the machines was
exactly the same and there were no differences in the instruction sets used (e.g.
on Haswell the CPython VM was not using AVX2 instructions). The following
were the profiles of the functions:





