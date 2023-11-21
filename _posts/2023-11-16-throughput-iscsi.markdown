---
layout: post
title:  "Data driven throughput maximization of iSCSI storage setup"
date:   2023-10-13 08:00:00
published: false
pygments: true
toc: true
tags: [linux, storage, iscsi]
---

Benchmarking my iSCSI setup

High latency links: https://scst.sourceforge.net/max_outstanding_r2t.txt

How I got to this choice
=======

Bandwidth (MiB/s), IOPS, Hitachi spinning disk, ioengine=sg, 1 thread. Network latency: 4.5ms, 600 MiB/s wireless network

|       | Raw device (MiB/s, IOPS)  | iSCSI target (MiB/s, IOPS, CPU util, CPU max IOPS) | Projected performance (IOPS, MiB) |
| :---- | :------:                  | :----:                                             |:----:                 |
| 64k   |   128/2055                |  18.3/292/7%/4170                                  |                       |
| 128k  |   135/1082                |  17/138/7%/1971                                    |                       |
| 256k  |  137/546                  |  24.4/97/8%/1212                                   |                       |  
| 512k  |  137/273                  |  28.7/57/10%/570                                   |                       |
| 1M  |    136/136                  |  30.8/30/12%/250                                   |                       |
| 2M  |     136/67                  |  33.1/16/14%/207                                   | 15.3/                   | 


Bandwidth (MiB/s), IOPS, Samsung SSD, ioengine=sg, 1 thread

|       | Raw device      | iSCSI target | Network | iSCSI initiator |
| :---- | :------:       | :----:            |:----: | :----:|
| 64k   |  329/5268             | -            |1 | 2|
| 128k  |  348/2786     | -            |1 | 2|
| 256k  |  359/1434             | -            |1 | 2| 
| 512k  |  363/726            | -            |1 | 2|
| 1M  |    360/360          | -            |1 | 2|
| 2M  |    354/176          | -            |1 | 2|


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


R2T 16:

echo "1000/(2.2+0.92+2.2+2.2+((1984/64)*0.92+8.77)+2.2)*2" | bc -l

42.5, real is 40 MiB


R2T 1:

echo "1000/(2.2+0.92+(2.2+2.2+256/64*0.92)*7+(2.2+((256-64)/64)*0.92+2.2)+2.2+8.7)*2" | bc -l

25.7, real iw 31.3 MiB
