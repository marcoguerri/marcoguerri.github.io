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
| RAM      | 64 GiB DDR3, fully balanced NUMA domains  | 128 GiB DDR4, fully balanced NUMA domains|
| OS     | CentOS 7.3 running kernel 3.10.0-514  | CentOS 7.3 running kernel 3.10.0-514 |
| gcc    | 4.8.5 | 4.8.5 |
| CPU clk    | 2.00GHz, acpi_cpufreq userspace | 2.00GHz, acpi_cpufreq userspace |


The clock frequency was set to 2.00GHz via userspace governor with *acpi_cpufreq*
driver. Disregarding for a moment the output of the benchmark, which is not 
relevant, the runtime on the two platforms was the following:

```
[root@ivybridge ~]# time numactl --physcpubind=0 --membind=0 python lhcb.py 
8.62366333218

real    0m58.239s
user    0m58.007s
sys 0m0.225s

[root@haswell ~]# time numactl --physcpubind=0 --membind=0 python lhcb.py 
12.8205128205

real    0m39.315s
user    0m38.977s
sys 0m0.319s
```

The runtime highlights a speedup close to 50%. 


Instruction set
=======
In order to make sure the Python 
interpreter was making use of the same instruction set on both architectures, I first 
traced the benchmarks with Intel Software Development emulator. SDE is a dynamic 
binary instrumentation tool capable of tracing the execution down to the assembly 
instruction level, providing emulation support on Intel platforms for instructions
sets that are not natively supported by the hardware (e.g. it is possible to test 
AVX512 code on a machine which provides only AVX2). Intel SDE is based on Pin
library, which uses *ptrace* system call on Linux to inject instrumentation 
code into the application. Each instruction of the application is replaced with
a jmp to the instrumentation, allowing to gain control over every single 
instruction executed. Clearly, this has a bearing on the runtime.

The first result obtained with SDE was a profile of the functions executed 
by the benchmarks. Ivy Bridge functions-breakdown, limited to the first 10
contributors, was the following:

```
0:  78447041164  40.065  40.065      25000610      7fafdb921d00 PyEval_EvalFrameEx  IMG: /lib64/libpython2.7.so.1.0
1:  20255778100  10.345  50.410             0      7fafdb88b700 _Py_add_one_to_index_C  IMG: /lib64/libpython2.7.so.1.0
2:  12676220173   6.474  56.884             1      7fafdb8b07b0 PyFloat_GetInfo  IMG: /lib64/libpython2.7.so.1.0
3:   7329255341   3.743  60.627             1      7fafdb8c39f0 _PyLong_Init     IMG: /lib64/libpython2.7.so.1.0
4:   7048205162   3.600  64.227     542169587      7fafdb8b06f0 PyFloat_FromDouble  IMG: /lib64/libpython2.7.so.1.0
5:   6911426092   3.530  67.756             1      7fafcc46e310 .text            IMG: /usr/lib64/python2.7/lib-dynload/_randommodule.so
6:   6048087389   3.089  70.845             2      7fafdb8adc00 Py_UniversalNewlineFread  IMG: /lib64/libpython2.7.so.1.0
7:   5218234381   2.665  73.510      34216947      7fafdaea0450 __ieee754_log_avx  IMG: /lib64/libm.so.6
8:   5001235968   2.554  76.065     125029399      7fafdb8c6280 PyDict_GetItem   IMG: /lib64/libpython2.7.so.1.0
9:   4450066224   2.273  78.337            76      7fafdb8b2bb0 _PyFloat_Unpack8  IMG: /lib64/libpython2.7.so.1.0
```

Haswell functions-breakdown, also limited to the first 10 contributors, was 
the following:
```
0:  78443984168  40.061  40.061      25000613      7f547808ed00 PyEval_EvalFrameEx  IMG: /lib64/libpython2.7.so.1.0
1:  20255041770  10.344  50.406             0      7f5477ff8700 _Py_add_one_to_index_C  IMG: /lib64/libpython2.7.so.1.0
2:  12675720283   6.474  56.879             1      7f547801d7b0 PyFloat_GetInfo  IMG: /lib64/libpython2.7.so.1.0
3:   7329059493   3.743  60.622             1      7f54780309f0 _PyLong_Init     IMG: /lib64/libpython2.7.so.1.0
4:   7047863171   3.599  64.222     542143280      7f547801d6f0 PyFloat_FromDouble  IMG: /lib64/libpython2.7.so.1.0
5:   6910893488   3.529  67.751             1      7f546902d310 .text            IMG: /usr/lib64/python2.7/lib-dynload/_randommodule.so
6:   6047790337   3.089  70.840             2      7f547801ac00 Py_UniversalNewlineFread  IMG: /lib64/libpython2.7.so.1.0
7:   5217908380   2.665  73.504      34214316      7f5477611450 __ieee754_log_avx  IMG: /lib64/libm.so.6
8:   5001228296   2.554  76.059     125029216      7f5478033280 PyDict_GetItem   IMG: /lib64/libpython2.7.so.1.0
9:   4450065996   2.273  78.331            76      7f547801fbb0 _PyFloat_Unpack8  IMG: /lib64/libpython2.7.so.1.0

```

What immediately stands out from the traces above is the following:

   * The two executions are pretty much identical
   * The runtime is dominated by the Python interpreter, CPython, with 
    *PyEval_EvalFrameEx*, the core function that interprets Python bytecode
   *  *_randommodule.so* contributes only for 3.5% of the execution time, while
     all other contributions are mostly coming from CPython

For each function listed above, I created an histogram of the instructions executed.


PyEval_EvalFrameEx
=======
