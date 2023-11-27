---
layout: post
title:  "Data driven throughput maximization of iSCSI storage setup"
date:   2024-10-13 08:00:00
published: true
pygments: true
toc: true
tags: [linux, storage, iscsi]
---

I have run some tests on my iSCSI backend, specifically with the intent of reaching line speed
both on wired and wireless network. This attempt forced me to try to produce a model
which describes the throughput of the setup. What I eventually got seems to work, but this doesn't
mean it correctly describes the iSCSI stack. In fact, my understanding of the lifecycle of an iSCSI
Write/Read request is still far to shallow to give me any confidence in the result of this exercise.
It is my intention to review the content of this post in the future, if I manage to develop a better
understanding of LIO. I still wanted to collect my notes here to seek feedback from somebody with
better understanding of iSCSI.

Benchmarking my iSCSI setup

High latency links: https://scst.sourceforge.net/max_outstanding_r2t.txt

`fio` benchmarks
=======

General parameters:
* `direct=1`
* `sync=0`
* iodepth=1


The iSCSI backend is configured as follows
The spinning drive is a Hitachi Ultrastar (7.2k) with SATA interface. Client and server are connected over wireless
network which provides a real throughput of 600 MiB/s, verified through `iperf3` and average RTT latency of 4.5ms.

Benchmark on iSCSI target has been executed with `libiscsi` engine. It must be noted however that `libiscsi` seems to
be negotiating some session parameters without honoring target configuration on the backend. 

|       | Raw device (MiB/s, IOPS)  | iSCSI target (MiB/s, IOPS, CPU util, CPU max IOPS) | Projected performance (IOPS, MiB) |
| :---- | :------:                  | :----:                                             |:----:                 |
| 64k   |   128/2055                |  18.3/292/7%/4170                                  |                       |
| 128k  |   135/1082                |  17/138/7%/1971                                    |                       |
| 256k  |  137/546                  |  24.4/97/8%/1212                                   |                       |  
| 512k  |  137/273                  |  28.7/57/10%/570                                   |                       |
| 1M  |    136/136                  |  30.8/30/12%/250                                   |                       |
| 2M  |     136/67                  |  33.1/16/14%/207                                   | 15.3/                   | 



List available LUNs: 

```
$ /usr/bin/iscsi-ls -i iqn.1994-05.com.redhat:3327c77e8127 -s iscsi://192.168.1.220:3260
```


This is spinning drive:
```
iscsi\://192.168.1.220\:3260/iqn.2003-01.org.linux-iscsi.alarm.armv7l\:sn.2a40443560f5/0
```

This is the SSD:
```
iscsi\://192.168.1.220\:3260/iqn.2003-01.org.linux-iscsi.alarm.armv7l\:sn.2a40443560f5/1
```


To show directly URLs: 
```
$ /usr/bin/iscsi-ls -i iqn.1994-05.com.redhat:3327c77e8127 --url iscsi://192.168.1.220:3260
```

`fio` benchmark is executed with `direct=1 (`O_DIRECT`) and `sync=0` (no `O_SYNC`), so we are bypassing caches between
kernel and userspace but we are queueing write requests to be served by the device asynchronously.
Therefore, we are appending to the queue at rate which should be constrained only by iSCSI
network communication. Considering 2M blocks, a model describing this communication could be the following,:
```
Request latency = 
  1. one-way latency for immediate data (64K)
  2. transmission duration of immediate data

  3. one-way latency for R2T
  4. one-way latency for data PDU
  5. transmission duration for 256K data
  6. goto 3. seven times

  7. one-way latency for R2T
  8. one-way latency for last fractional data PDU
  9. transmission duration for 256K-64K data

 10. one-way latency for "Command completed at target" message
```

Mapped to the benchmark results above, would give the following:
```
Request latency =
  1. 2.2ms | one-way latency for immediate data (64K)
  2. 0.87ms | transmission duration of immediate data

  3. 2.2ms | one-way latency for R2T
  4. 2.2ms | one-way latency for data PDU
  5. 0.87ms*256K/64K | transmission duration for 256K data
  6. goto 3. seven times

  7. 2.2ms | one-way latency for R2T
  8. 2.2ms | one-way latency for last fractional data PDU
  9. 0.87ms*(256K-64K)/64K | transmission duration for 256K-64K data

 10. 2.2ms | one-way latency for "Command completed at target" message
```

67.4ms, i.e. 29.7 MiB. This is pretty close to `fio` results, diverging by 5%.


However, test results on different devices disprove the validity of this model. In fact, by comparing test results on
the same high latency link as above between a SSD and the spinning drive used initially, it immediately stands out that despite
the request transmission latency over the network is significantly higher (at least double) than the request execution latency, in all cases,
the iSCSI throughput on the SSD is still higher. If the device was consuming requests asynchronously from the queue
at a rate which is double the IOPS we can reach on the link, then we should not see any effect on throughput, except
some queue contention that should not have noticeable impact at these rates. The model above needs to be therefore
adjusted to account for request execution latency.

One important detail to notice is that despite `fio` benchmark is executed with 2MB blocks, requests are submitted by the devices
in 1MB block size. We can therefore attempt to modify the model to account for 7.4ms of additional latency for each write request,
which corresponds to the time it takes to serve a 1M write request. The new expectation would be 26.7 MiB/s, diverging by 15% from
the actual number.

If we analyze the results over 1 Gbps wired link, we can draw even further observations.



The test below has been executed over a 1 Gbps wired link, with a one-way latency of ~0.15ms. Running the test
over the spinning disk or the SSD gives incontrovertibly different results. If we add to the model above
the per-operation I/O latency, we obtain far more accurate projection of the throughput over the wired link.

Bandwidth (MiB/s), IOPS, Samsung SSD, ioengine=sg, 1 thread

|       | Raw device      | iSCSI target | Network | iSCSI initiator |
| :---- | :------:       | :----:            |:----: | :----:|
| 64k   |  329/5268             | -            |1 | 2|
| 128k  |  348/2786     | -            |1 | 2|
| 256k  |  359/1434             | -            |1 | 2| 
| 512k  |  363/726            | -            |1 | 2|
| 1M  |    360/360          | -            |1 | 2|
| 2M  |    354/176          | -            |1 | 2|


R2T 16:

echo "1000/(2.2+0.92+2.2+2.2+((1984/64)*0.92+8.77)+2.2)*2" | bc -l

42.5, real is 40 MiB


R2T 1:

echo "1000/(2.2+0.92+(2.2+2.2+256/64*0.92)*7+(2.2+((256-64)/64)*0.92+2.2)+2.2+8.7)*2" | bc -l

25.7, real iw 31.3 MiB
