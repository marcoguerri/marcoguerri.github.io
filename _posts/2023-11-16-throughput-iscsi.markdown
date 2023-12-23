---
layout: post
title:  "Data driven throughput maximization of iSCSI storage setup"
date:   2024-10-13 08:00:00
published: true
pygments: true
toc: true
tags: [linux, storage, iscsi]
---

I have run some tests on my iSCSI backend, with the intent of planning several upgrades, including
whether I should route ethernet cables to the studio, as I am currently
on a wireless network. This exercise forced me to try to produce a model that describes the
throughput of iSCSI requests.  What I eventually got seems to work and it enabled me to make data driven
performance projections with different configurations that I then verified experimentally.

While the model is precise enough to be useful in the configurations I have tested, I cannot guarantee 
it will be accurate if those conditions change. Unfortunately, my understanding of iSCSI is still too
shallow. It is my intention to review the content of this post in the future, but for now, I could
predict throughput on multiple setups (e.g. Gigabit ethernet instead of wireless, SSD instead on spinning disk), 
with an acceptable degree of accuracy, so I consider this is a good start.


High latency links: https://scst.sourceforge.net/max_outstanding_r2t.txt

NAS setup
=======
The NAS which exports the iSCSI volume runs on a [Helios4 board](https://kobol.io/helios4/) 
(the legacy 32-bit one, not the updated Helios 64-bit SoC). The chassis has been 3d printed,
though it is still missing the front, back and rear panels (I only had  a 3d printer available
for a limited amount of time and haven't decided yet if I would make a good use of my own one).
Initially the NAS was fitted with Hitachi Ultrastar (7.2k) SATA spinning disks, but I have
added a Samsung EVO SSD to get latency numbers also on Solid State Drive.

The goal of the performance analysis was mainly to answer the following questions:
* Why am I getting 30 MiB/s of Direct I/O sequential write throughput if network and storage,
even with spinning disks, can run much faster? In particular, network transfers can reach 75 MiB/s (`iperf3`),
storage can handle even higher throughput sequential writes.
* What would be the gain if I routed Gigabit ethernet to the clients?
* What would be the gain if I replaced the current spinning disks setup with SSDs?

Network configuration
=======
By default, the NAS is on a wireless 802.11ac network. Throughput is
600 Mbit/s, measured with `iperf3`. In terms of latency, to which we will see iSCSI
is very much sensitive, I initially estimated 4ms of RTT by just looking at the
delays recorded by `ping`. However, after collecting more samples and looking more closely at the results, 
I realized that when ping uses 1s intervals between packets, we get a bimodal latency distribution as in the picture below.

<p align="center">
<img src="/img/iscsi/latency-distribution-wireless.png" alt="" style="max-width: 100%"/>
</p>

4ms is actually the center of the higher distribution. In fact, using 4ms as RTT latency in the performance model results
in underestimating the real throughput. The bimodal distribution does not appear if ping interval is 2ms, which is much closer to the 
interval between iSCSI packets exchanged during I/O. I am not sure I can fully explain why we see a bimodal distribution
and I will need to run more tests. My current thought is that the standard deviation is too significant to be attributed at a
nything else but the network. In the model that follows, I have used the average of the 
`2ms` interval distribution, which not surprisingly yields much more precise results.

I have also collected throughput and latency measurements on wired Gigabit Ethernet, so that I could input these values to the
model and make predictions on the overall iSCSI workload. The throughput measured with `iperf` is 930 Mbit/s, while latency results are
shown in the graph below. The distribution shows clearer multi modes 
in the `2ms` interval results. However, given a more reasonable Coefficient of variation (standard deviation over the mean) in this 
distribution compared to the 802.11ac network, I have just used the average over all the 2ms samples. 

<p align="center">
<img src="/img/iscsi/latency-distribution-wired.png" alt="" style="max-width: 100%"/>
</p>

Below I have collected a summary of the latency statistics with different intervals on wired and wireless network 
(i.e. `ping -i <INTERVAL>`). The numbers are conveniently calculated on the command line with 
`datamash mean 1 perc:50 1 perc:99 1 max 1 sstdev 1`. I have collected 15 minutes worth of samples at different packet
intervals, so the overall number of samples collected is obviously different. It is good enough, for the scope of the problem 
I am dealing with.


|               | mean (ms)   | p50 (ms)  | p99 (ms)  | max (ms) | sstdev |  Coff. var |
| :----         | :------:    | :----:    | :----:    | :----:   | :----: |  :----:    |
| wired 1s      | 0.31        | 0.32      | 0.54      | 0.90     | 0.06   |  19.5%     |
| wireless 1s   | 5.50        | 4.42      | 34.61     | 299      | 12.95  |  234.5%    |
| wired 2ms     | 0.22        | 0.18      | 0.35      | 0.77     | 0.05   |  22.7%     | 
| wireless 2ms  | 2.95        | 2.64      | 7.63      | 133      | 3.32   |  112.5%    | 


`fio` benchmarks
=======
The basic configuration for `fio` benchmarks is the following:
* `direct=1`
* `sync=0` (default)
* `numjobs=1`
* `size=5G`
* `rw=write` (sequential workload)

I have used `fio-3.30` for block devices tests and built from sources `fio-3.36-17` for `libiscsi` tests.
The default configuration of the "parameters" section of the iSCSI backend is the following:


| Parameter                | Value       |
|--------------------------|-------------|
| AuthMethod               | CHAP,None   |
| DataDigest               | CRC32C,None |
| DataPDUInOrder           | Yes         |
| DataSequenceInOrder      | Yes         |
| DefaultTime2Retain       | 20          |
| DefaultTime2Wait         | 2           |
| ErrorRecoveryLevel       | 0           |
| FirstBurstLength         | 65536       |
| HeaderDigest             | CRC32C,None |
| IFMarkInt                | Reject      |
| IFMarker                 | No          |
| ImmediateData            | Yes         |
| InitialR2T               | No          |
| MaxBurstLength           | 262144      |
| MaxConnections           | 1           |
| MaxOutstandingR2T        | 1           |
| MaxRecvDataSegmentLength | 8192        |
| MaxXmitDataSegmentLength | 262144      |
| OFMarkInt                | Reject      |
| OFMarker                 | No          |
| TargetAlias              | LIO Target  |

<br>


fio benchmarks have been executed in three different configurations:
* Locally, with `sg` engine
* Remotely, directly on iSCSI exported block device (e.g. `file=/dev/<BLOCK_DEVICE>`), with default I/O engine
* Remotely, with `libiscsi` engine. It must be noted however that `libiscsi` seems to be negotiating some session parameters 
without honoring target configuration on the backend, so for example even if the backend is configured to use `MaxOutstandingR2T=16`, 
I still see `MaxOutstandingR2T=1` being negotiated. The set of default parameters used by `libiscsi` in my tests were as per the 
screenshot below:
<p align="center">
<img src="/img/iscsi/libiscsi-login.png" alt="" style="max-width: 100%"/>
</p>
and the full `fio` configuration file is reported below.

<details> <summary>fio configuration file for libiscsi tests</summary> 
{% highlight text  %}
[sequential-write]
rw=write
size=5G
direct=1
numjobs=1
group_reporting
name=sequential-write-direct
bs=2M
sync=0
runtime=60
ioengine=libiscsi
filename=iscsi\://192.168.1.220\:3260/iqn.2003-01.org.linux-iscsi.alarm.armv7l\:sn.2a40443560f5/0
{% endhighlight %}
</details>


Local benchmarks
=======
The following table summarizes the results of local benchmarks, i.e. using `sg` engine directly on the drive.

|       | fio `sg` HDD | `fio` sg SSD |
|       | (MiB/s, IOPS) | (MiB/s, IOPS) |
| :---- | :------:      | :------:      |
| 64k   |   128/2055    | 329/5268	    |
| 128k  |   135/1082    | 348/2786      |
| 256k  |  137/546      | 359/1434      |
| 512k  |  137/273      | 363/726       |
| 1M  |    136/136      | 360/360       |
| 2M  |     136/67      | 354/176       |


Wireless network benchmarks
=======
The folloing table shows the results of remote (block device and libiscsi) benchmarks on wireless network:

|       | fio `libiscsi` HDD       | fio iSCSI block dev HDD | fio iSCSI block dev SSD|
|       | (MiB/s, IOPS, CPU util)  | (MiB/s, IOPS) | (MiB/s, IOPS)|
| :---- | :----:                   | :----:           | :----: |
| 64k   | 18.3/292/7%              |  15.5/237        | 13.7/219|
| 128k  | 17/138/7%                |  15.1/121        | 14.8/118| 
| 256k  | 24.4/97/8%               | 22.6/90          | 21.8/87 |
| 512k  | 28.7/57/10%              | 27.5/54          | 29.3/58 |
| 1M    | 30.8/30/12%              | 30.1/30          | 33.4/33|
| 2M    | 33.1/16/14%              | 31.0/15          | 34.5/17 |

<br>

As mentioned earlier, `fio` benchmarks are executed with `direct=1` (`O_DIRECT`) and `sync=0` (no `O_SYNC`), so we are bypassing 
caches between
kernel and userspace but we should be queueing write requests to be served by the device asynchronously. In practice however,
this is not what I am observing. We see from block device benchmarks above that HDD and SSD block device throughputs from the 
client perspective differ by 10% at 2M. I explain this result with the drive being on a synchronous path for the request.  

If device I/O was fully asynchronous, the
client should not see any difference, as the slowest link in the chain is network transfer and the rate at which requests
are queued should be bottlenecked by network. In fact, we are doing only 15 IOPS end to end, while the spinning disk at 2M 
is able to handle 67 raw IOPS and CPU is at 14% utilization, which if projected linearly, should result in ability to 
handle ~112 IOPS at 100% utilization. I don't understand enough of LIO implementation to tell if this is expected or is a 
result of a misconfiguration of my backend, I'll need to go through the source code.

On the network side, `iperf3` benchmarks show sustained 75 MiB/s (600 Mbit/s) (that would correspond to 38 IOPS at 2M). 
This however is the best case scenario,
with a communication consisting in a raw stream of bytes. iSCSI communication involves much more 
back and forth between server and client. In particular, a look at network traffic gives an idea of what messages are 
being exchanged:

<p align="center">
<img src="/img/iscsi/r2t_1.png" alt="" style="max-width: 100%"/>
</p>


The target sends a R2T (Ready to Transfer) packet for every Data PDU (256 KiB) necessary to make up the block size, 2M in this case. 
Every single R2T introduces a full one-way latency cost, and so does the Data PDU answer. So, considering 2M blocks, a model describing 
this communication  could be the following:

|  | Request latency           |
|-- | --------------------------|  
| 1 | one-way latency for immediate data (64K)|
| 2 | transmission duration of immediate data |
| 3 |  one-way latency for R2T |
| 4 | one-way latency for data PDU|
| 5 | transmission duration for 256K data|
| 6 |  goto 3. seven times |
| 7 |  one-way latency for R2T |
| 8 |  one-way latency for last fractional data PDU |
| 9 | transmission duration for 256K-64K data |
| 10 | one-way latency for "Command completed at target" message |

<br>
Mapping the benchmark results above to this model would result in the following:

|   |     |Request latency           |
|-- | --  |--------------------------|  
| 1 | 1.5ms  | one-way latency for immediate data (64K)|
| 2 | 0.87ms | transmission duration of immediate data |
| 3 | 1.5ms |  one-way latency for R2T |
| 4 | 1.5ms |one-way latency for data PDU|
| 5 | 0.87ms*256K/64K |transmission duration for 256K data|
| 6 |  | goto 3. seven times |
| 7 | 1.5ms | one-way latency for R2T |
| 8 | 1.5ms | one-way latency for last fractional data PDU |
| 9 |  0.87ms*(256K-64K)/64K | transmission duration for 256K-64K data |
| 10 | 1.5ms | one-way latency for "Command completed at target" message |


<br>

This however takes into account only network I/O. In terms of CPU cycles of the `iscsi_trx` kernel thread, 
I am unclear what exactly is being done in that time (e.g. CRC calculation, but some quick tests indicate that
there far more than that) and I'll
have again to take a closer look into LIO source code. Assuming that time is synchronous to the request.

In order to decide how much time to attribute to every 2M operation, we need first to consider
that the latency cost coming from the synchronous request handling by the drive needs to be aligned with the "real" IO size. 
In fact, despite iSCSI is working with 2M blocks, the drive sees 1M requests:
```
Device            r/s     rkB/s   rrqm/s  %rrqm r_await rareq-sz     w/s     wkB/s   wrqm/s  %wrqm w_await wareq-sz     d/s     dkB/s   drqm/s  %drqm d_await dareq-sz     f/s f_await  aqu-sz  %util
mmcblk0          0.00      0.00     0.00   0.00    0.00     0.00    0.00      0.00     0.00   0.00    0.00     0.00    0.00      0.00     0.00   0.00    0.00     0.00    0.00    0.00    0.00   0.00
sda              0.00      0.00     0.00   0.00    0.00     0.00    0.00      0.00     0.00   0.00    0.00     0.00    0.00      0.00     0.00   0.00    0.00     0.00    0.00    0.00    0.00   0.00
sdb              0.00      0.00     0.00   0.00    0.00     0.00   30.00  30720.00     0.00   0.00    6.70  1024.00    0.00      0.00     0.00   0.00    0.00     0.00    0.00    0.00    0.20  18.00
```
I have tested that for all block sizes, the drive is serving operations of half of the block size (to
be clarified why this is the case). This is important as the synchronous latency we want to add to the model 
above should reflect 1M I/O, assuming that a 2M request can be split in half on the fly and the initial 1M 
latency can be shadowed by the second half of the network block transfer, at least partially. 
To transfer 1M, we would need`0.87 ms (64 KiB transfer) * 16 = 13.9 ms`. A single 1M IO request on the HDD would take 
`1000ms /136 IOPS = 7.3 ms`, so this seems to be reasonable. 

I have decided to attribute to the request all CPU cycles as synchronous latency, which puts the results 
in the worst case scenario. The reason is that according to the reasoning above, the faster the network becomes, 
the higher would be the impact of CPU processing as the shadowing effect would become less relevant.
I have used the 1M request latency as reference (with 12% CPU utilization at 30 IOPS), which yields 8ms per 2MB request. 

If we put everything together: 

```
1.5+0.87+(1.5+1.5+256/64*0.87)*7+(1.5+((256-64)/64)*0.87+1.5)+1.5+7.3+8 = 70.14 ms (14.3 IOPS, 28.5 MiB/s)
```

We see 31.0 MiB/s on the block device benchmark so, we get a projection that diverges by ~8% from the real value.

Reducing R2T latency
=======

Projections
=======


Wired network projections, HDD
=======
What value can we project on the wired network? We'll consider a mean one-way latency 0f 0.11 ms and 0.5 ms to transfer
64 KiB. However, an adjustment needs to be made to the model above. On a Gigabit network, transferring 1M requires
`0.5 ms (64 KiB tranfer) * 16 = 8 ms`. This is very close to the time it takes for the drive to serve a 1M IO request,
7.3 ms. This means that depending on other latency contributions that occur once half of the block has been received (
e.g. a fraction of the CPU time), those 7.3 ms might be pushed beyond the time window to transfer the second half of
the block. Essentially, the final latency we added in the model above, 7.3 ms, might be higher here. In fact, with 7.3 ms, 
the project value is off the target by ~30%. Consider that at 30 IOPS (1MB), CPU utilization 12%, if we linearly distribute
this contribution we get ~4ms per 1M request. Assuming that CPU processing pushes the 7.3ms of the first 1M half of the block
beyond the transfer window of the second 1MB block (something I need to clarify is why this would not be visible for the second half
block), we increase the 7.3ms to (7.3+4)ms, 11.3ms.
```
0.11+0.5+(0.11+0.11+256/64*0.5)*7+(0.11+((256-64)/64)*0.5+0.11)+0.11+7.3+4.4 = ? ms (33.69 IOPS, 67.4 MiB/s)
```

Experimentally, we get 62 MiB/s (32 IOPS), which is ~8.7% off. It is more significant than what we got for the wireless network, but
still acceptable for the problem I need to solve. The good news is that we can gain more accuracy if we push down that final
contribution coming from drive I/O. And we can do that by moving to SSD.

Wired network projections, SSD
=======
The latency for serving a 1M I/O request on SSD is 2.7ms, so it should be well within the transfer time window of 1M and therefore
we don't need to add any adjustment to the first formula. On 1 Gbps wired network, we would get:

```
0.11+0.5+(0.11+0.11+256/64*0.5)*7+(0.11+((256-64)/64)*0.5+0.11)+0.11+2.77+4.4 = ? (39.87 IOPS, 79.7 MiB/s). 
```

10.7% off, real result is 72 MiB, 36 IOPS

```
(1000/(0.11+0.5+0.11+0.11+((1984/64)*0.5)+0.11+2.7+4.4))*2 = (84.9 MiB/s)
```

Real result is 82 MiB/s, 41 IOPS. Pretty close, 3.5%
R2T 16

| R2T    | I/O lat (1M) | CPU lat (1M\*2) | Net lat | Net 64 KiB (MiB/s) |  | Ops (ms) | IOPS             | Est. thr (MiB/s) | Actual thr (MiB/s) | Error (%)        |
| ------ | :----------: | :-----------: | :-------: | :------------------------: |  | :--------: | :----------------: |:-----------------------------: | :-------------------------: | :----------------: |
| 1  | 7.3        | 8           | 1.5     | 0.87                     |  | 70.14    | 14.26 | 28.51              | 31                        | 8.02 |
|        | 7.3        | 8           | 0.11    | 0.5                      |  | 33.28    | 30.05 | 60.1              | 62                        | 3.07 |
|        | 2.7        | 8           | 0.11    | 0.5                      |  | 28.68    | 34.87 | 69.74              | 72                        | 3.15 |
|        |            |             |         |                          |  |          |                  |                               |                           |                  |
|        |            |             |         |                          |  |          |                  |                               |                           |                  |
| 16 | 2.7        | 8           | 0.11    | 0.5                      |  | 27.14    | 36.85 | 73.69              | 82                        | 10.13 |
|        | 7.3        | 8           | 0.11    | 0.5                      |  | 31.74    | 31.56 | 63.01              | 70                        | 9.98 |
|        | 7.3        | 8           | 1.5     | 0.87                     |  | 49.14    | 20.35 | 40.70              | 42                        | 3.1 |





If we analyze the results over 1 Gbps wired link, we can draw even further observations.



If we set R2T to 16, we can observe the following on the network:
<p align="center">
<img src="/img/iscsi/r2t_16.png" alt="" style="max-width: 100%"/>
</p>

R2T packets covering the whole Data PDU lenght are sent back-to-back.

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

Increasing R2T
=======

Conclusions
=======
