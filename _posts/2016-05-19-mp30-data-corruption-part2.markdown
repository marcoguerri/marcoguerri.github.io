---
layout: post
title:  "Network data corruption on Gigabyte R120-P31 - Part 2"
date:   2016-08-19 21:00:00
categories: jekyll update
---
Summary
=======
After investigating a data corruption issue encountered on a Gigabyte
ARM64 R120-MP31 at the application, transport and date link layer, I performed some
tests aimed at validating an alternative hypothesis, i.e. data corruption happening
in system RAM.


The hardware-software interface
=======
When an incoming frame is received on the 10GbE interface of the XGene-1, 
the controller is capable of mastering the bus and copying directly the data 
into system memory. The controller maintains a hardware ring buffer of available 
DMAable memory regions where to copy incoming frames. When the NIC runs out of 
regions, the hardware ring buffer is refilled by the driver. The DMAable addresses 
are basically `sk_buff` allocated with `netdev_alloc_skb_ip_align`. This function 
allocates a virtual addresses that is immediately mapped to a physical region. 
When user space processes allocate memory via `malloc`, the underlying `brk` or 
`mmap` syscalls add a particular mapping to the virtual address space of the 
process but a physical frame is normally not reserved until the first page fault. 
In this case, however, the newly allocated address must be passed over to the hardware 
which accesses system memory without going through the CPU MMU, making it necessary
to have a mapping immediately available. Hardware devices are not always 
capable of DMAing directly to physical addresses. There is usually IOMMU hardware 
that translates addresses as seen by the device to physical ones: the kernel allows 
to obtain a valid DMAble address for the device via the DMA API. 
In this case `dma_map_single` is used.

Retrieving frames from system RAM
=======
In the xgene-enet driver, the function responsible for retrieving frames that 
have been DMAed to memory is `xgene_enet_rx_frame`. This function is called
by the NAPI polling callback, `xgene_enet_napi`  registered by the driver upon 
initialization and it is basically responsible for the following operations:

  * it validates the incoming `sk_buff` checking for hardware I/O errors
  * it strips off the CRC 
  * it disables TCP checksum validation if already performed by the hardware
  * it updates RX counters
  * it passes the `sk_buff` to the upper layers of the stack via `napi_gro_receive`

By invoking the GRO receive function, the driver makes use of the 
Generic Receive Offload capabilities provided by the kernel that allow to merge 
TCP segments into single `sk_buff`. GRO is the receive counterpart of 
`tcp-segmentation-offload`, a feature of ethtool-enabled hardware that performs
hardware segmentation of outgoing TCP segments. Both on the receive and transmit side, 
segmentation allows to send fewer `sk_buff`  through the network stack, 
with a significant increase in performance while still transmitting on the wire
chunks of data sized in a way that can be easily handled by routers, switches, etc.
The following is an brief example of the initial control path for incoming frames 
obtained with `ftrace`.

```   
 2)               |  xgene_enet_napi() {
 2)               |    xgene_enet_process_ring() {
 2)               |      xgene_enet_rx_frame() {
 2)   0.220 us    |        __swiotlb_unmap_page();
 2)   0.120 us    |        skb_put();
 2)   0.220 us    |        eth_type_trans();
 2)               |        napi_gro_receive() {
 2)   0.140 us    |          skb_gro_reset_offset();
 2)               |          dev_gro_receive() {
 2)               |            inet_gro_receive() {
 2)               |              tcp4_gro_receive() {
 2)   0.240 us    |                tcp_gro_receive();
 2)   1.440 us    |              }
 2)   2.740 us    |            }
 2)   4.180 us    |          }
 2)               |          netif_receive_skb_internal() {
[...]
```

As already mentioned, the DMAable addresses that are passed to the hardware 
ring buffers point directly to the `data` field of the `sk_buff`s. A further hypothesis 
I wanted to validate was whether corruption was happening when data was 
DMAed and subsequently read from memory due to faulty RAM (e.g. flipped bits that
ECC checks could not correct).


Validating frames after DMA transfers
=======
In order to check whether `xgene_enet_rx_frame` was receiving data already corrupted
from system memory, I wrote some code that would perform the following steps:
    
  * Trap `xgene_enet_rx_frame`
  * Calculate the CRC and compare it with the one in the FCS field of the frame
  * Print the physical address of the frame upon detection of a mismatch in order
    to spot possible patterns or recurrent memory areas.

The implementation is based on a kernel `jprobe`, a Linux feature
that allows to assign a callback to a kernel function with the capability 
of inspecting the function's arguments. At the time of testing, the latest kernel 
version available (4.7.0) was not supporting officially jprobes for ARM64. Several 
implementations had already been circulated in the kernel mailing list, the latest 
one being from Sandeepa Prabhu on the 8th of July 2016 (`arm64: Kprobes with single 
stepping support`). This series of 10 patches cleanly applied against kernel 4.6.0 
(aka 2dcd0af5), which is the one I used for this experiment. As a side note, I had to disable
`CONFIG_ARM64_ERRATUM_843419` in the kernel configuration to work around a 
relocation error ("unsupported RELA") that was being raised when loading the module.


Results from the probe
=======
What immediately stands out when running the jprobe is that the code is definitely not
optimized for speed. When loading the kernel module and transferring data
over the SFP+ interface, the `softirq` which is running the NAPI handler
goes 100\% CPU utilization and the throughput drops to a bare ~8MB/s. Nonetheless,
the jprobe does its job: after having transferred around 30 GB of data coming from 
/dev/zero, there were 69 `sk_buff` for which the CRC could not be validated:

```
[1513584.424677] Calculated CRC is 50b477c,  CRC in frame is 5ccfcebe, phys: 0000008051da2c02, 0000008051da2c02
[1513628.119962] Calculated CRC is fd4e97fc,  CRC in frame is e34ba66c, phys: 000000805e182382, 000000805e182382
[1513656.995813] Calculated CRC is 8c725bf1,  CRC in frame is 12953b1d, phys: 000000804c145682, 000000804c145682
[1513677.473247] Calculated CRC is 22665372,  CRC in frame is 12bfc315, phys: 000000804c7a7002, 000000804c7a7002
[...]
[1513685.219367] Calculated CRC is 4ad9905d,  CRC in frame is 424e3943, phys: 000000804c145f02, 000000804c145f02
```
<!--
[1513704.518584] Calculated CRC is f7d94c71,  CRC in frame is 988a84c8, phys: 00000080565dab82, 00000080565dab82
[1513734.334714] Calculated CRC is beeeefff,  CRC in frame is ae1af712, phys: 000000805e0d6782, 000000805e0d6782
[1513755.461138] Calculated CRC is 48897fa7,  CRC in frame is 555ad1f9, phys: 000000805e180182, 000000805e180182
[1513771.513057] Calculated CRC is 60a4a609,  CRC in frame is e25854a, phys: 000000805e184582, 000000805e184582
[1513775.525500] Calculated CRC is df2c9ff1,  CRC in frame is 237bdda9, phys: 000000804c7a4e02, 000000804c7a4e02
[1513788.081796] Calculated CRC is 5b8b3f44,  CRC in frame is 9d9aa8b6, phys: 0000008051da1282, 0000008051da1282
[1513811.017600] Calculated CRC is 45aa6eb,  CRC in frame is 555931a1, phys: 000000805e185682, 000000805e185682
[1513841.440076] Calculated CRC is 1c8bf89e,  CRC in frame is 9e4491b, phys: 0000008051daab82, 0000008051daab82
[1514118.357560] Calculated CRC is a318c885,  CRC in frame is f42b8a06, phys: 0000008051dad602, 0000008051dad602
[1514152.821200] Calculated CRC is afbbefbf,  CRC in frame is d20bd83, phys: 000000804c7a5682, 000000804c7a5682
[1514204.658209] Calculated CRC is 2e840af6,  CRC in frame is dc3c188, phys: 00000000e8085f02, 00000000e8085f02
[1514280.402150] Calculated CRC is 70bf75a8,  CRC in frame is 4746cd57, phys: 000000805e183482, 000000805e183482
[1514293.204168] Calculated CRC is d59ac729,  CRC in frame is df3665aa, phys: 00000080565b6782, 00000080565b6782
[1514308.288253] Calculated CRC is f60cb887,  CRC in frame is 106a9a3e, phys: 000000805e187882, 000000805e187882
[1514414.397324] Calculated CRC is 576388e9,  CRC in frame is 3eb98801, phys: 0000008058877882, 0000008058877882
[1514471.528828] Calculated CRC is bb9f8def,  CRC in frame is bbba15c8, phys: 0000008058879202, 0000008058879202
[1514516.607016] Calculated CRC is 266f0f3e,  CRC in frame is 9ef16e9d, phys: 0000008056917002, 0000008056917002
[1514738.814471] Calculated CRC is 91581eb8,  CRC in frame is 58275a3a, phys: 000000805e09bc82, 000000805e09bc82
[1514803.825897] Calculated CRC is 8e8f8b3e,  CRC in frame is d2c11762, phys: 000000805695de82, 000000805695de82
[1514814.908076] Calculated CRC is 7b9f3d62,  CRC in frame is da57fd3f, phys: 000000805695e702, 000000805695e702
[1514920.876054] Calculated CRC is 1e82d02c,  CRC in frame is b5ce0013, phys: 000000805636ab82, 000000805636ab82
[1514962.499993] Calculated CRC is 952f912,  CRC in frame is c3f14991, phys: 0000008056574582, 0000008056574582
[1515026.855480] Calculated CRC is 1f7337ae,  CRC in frame is 107bb58d, phys: 0000008056267002, 0000008056267002
[1515077.772721] Calculated CRC is 6666269a,  CRC in frame is 8661113c, phys: 000000805da19a82, 000000805da19a82
[1515114.491968] Calculated CRC is b56d2893,  CRC in frame is 672aad0, phys: 00000000ec27a302, 00000000ec27a302
[1515252.754865] Calculated CRC is 6d9312cf,  CRC in frame is d64b682e, phys: 000000805e09ef82, 000000805e09ef82
[1515254.340562] Calculated CRC is 32b1b18c,  CRC in frame is f345c345, phys: 000000805e0a9a82, 000000805e0a9a82
[1515286.577657] Calculated CRC is d6852884,  CRC in frame is 956b6129, phys: 000000805691de82, 000000805691de82
[1515300.826041] Calculated CRC is c4f9b353,  CRC in frame is f5ed5981, phys: 000000805da1ef82, 000000805da1ef82
[1515304.744759] Calculated CRC is 2a1eb8e2,  CRC in frame is d071ad0f, phys: 0000008056913d02, 0000008056913d02
[1515307.938969] Calculated CRC is 6b526186,  CRC in frame is 3102a030, phys: 000000805e0a1b02, 000000805e0a1b02
[1515317.962076] Calculated CRC is 7b3e46a5,  CRC in frame is 569a89f5, phys: 000000805e0a6782, 000000805e0a6782
[1515454.116768] Calculated CRC is afd197fc,  CRC in frame is 8b55d2c3, phys: 0000008056367882, 0000008056367882
[1515735.044157] Calculated CRC is 2157a3c4,  CRC in frame is f5c8fb56, phys: 000000805682e702, 000000805682e702
[1515741.179024] Calculated CRC is b1ddda68,  CRC in frame is fad5d78, phys: 0000008056826782, 0000008056826782
[1515759.376832] Calculated CRC is 26bed728,  CRC in frame is ed2e98a0, phys: 0000008056821282, 0000008056821282
[1515863.004366] Calculated CRC is ce0240b6,  CRC in frame is 84591d31, phys: 000000805e1fc502, 000000805e1fc502
[1515872.097586] Calculated CRC is c342d27b,  CRC in frame is 779c64fe, phys: 000000804c149202, 000000804c149202
[1515929.222792] Calculated CRC is 4bbaaf81,  CRC in frame is 9cb81ae, phys: 000000805887e702, 000000805887e702
[1516012.344787] Calculated CRC is 4f01dd3b,  CRC in frame is 78167e55, phys: 00000000e0061b02, 00000000e0061b02
[1516121.978341] Calculated CRC is fb1f820,  CRC in frame is 7b7381e1, phys: 00000080565f1b02, 00000080565f1b02
[1516178.439118] Calculated CRC is e4e2de8c,  CRC in frame is 877f4a35, phys: 00000080565b8102, 00000080565b8102
[1516206.341141] Calculated CRC is defee768,  CRC in frame is 2dfbc2d1, phys: 0000008058876782, 0000008058876782
[1516211.872288] Calculated CRC is 703f01bc,  CRC in frame is 4f2e8139, phys: 000000805887b402, 000000805887b402
[1516565.746493] Calculated CRC is b5a1d5e4,  CRC in frame is d344a0cd, phys: 00000080565b7002, 00000080565b7002
[1516706.461049] Calculated CRC is 4ab48c4a,  CRC in frame is becebe9, phys: 000000805655cd82, 000000805655cd82
[1516722.705537] Calculated CRC is e70f7991,  CRC in frame is 200f0f12, phys: 000000804c148982, 000000804c148982
[1516736.264293] Calculated CRC is 28b70c98,  CRC in frame is 765da62b, phys: 000000805657b402, 000000805657b402
[1516776.113658] Calculated CRC is 12d507af,  CRC in frame is b9cc2bb1, phys: 0000008056572382, 0000008056572382
[1516787.856475] Calculated CRC is 783818f7,  CRC in frame is 9919feae, phys: 000000805204ef82, 000000805204ef82
[1516849.662018] Calculated CRC is 3bd2e77f,  CRC in frame is a20c2c81, phys: 000000805655e702, 000000805655e702
[1516874.454143] Calculated CRC is 11b75802,  CRC in frame is dd6d359e, phys: 0000008056556782, 0000008056556782
[1516968.868670] Calculated CRC is 62181f8b,  CRC in frame is 4d3608fa, phys: 000000805e1b4582, 000000805e1b4582
[1517037.373283] Calculated CRC is 57dfe616,  CRC in frame is d73633ec, phys: 000000805e1db402, 000000805e1db402
[1517068.822751] Calculated CRC is 7648dad6,  CRC in frame is dc051fd1, phys: 000000805e1dd602, 000000805e1dd602
[1517102.258242] Calculated CRC is 1c2666e4,  CRC in frame is 36c1f32d, phys: 00000080563c2c02, 00000080563c2c02
[1517197.593906] Calculated CRC is 8a6e37a5,  CRC in frame is 2a98653a, phys: 0000008051ddde82, 0000008051ddde82
[1517297.532873] Calculated CRC is 67f2ce1d,  CRC in frame is b1043dfe, phys: 0000008052045f02, 0000008052045f02
[1517505.224208] Calculated CRC is c0ec4c99,  CRC in frame is 356994c7, phys: 000000804c7abc82, 000000804c7abc82
[1517505.906874] Calculated CRC is d28a702b,  CRC in frame is 89c3393b, phys: 00000080563ce702, 00000080563ce702
[1517506.992264] Calculated CRC is 3a2d2727,  CRC in frame is 14c51c18, phys: 000000805f18de82, 000000805f18de82
[1517573.021449] Calculated CRC is 119b2bde,  CRC in frame is 11f68161, phys: 0000008051dd0a02, 0000008051dd0a02
[1517596.711465] Calculated CRC is ecd8f12e,  CRC in frame is bd01389d, phys: 000000805f186782, 000000805f186782
[1517677.146006] Calculated CRC is e0ceaa33,  CRC in frame is 9bb44cc1, phys: 000000805e18de82, 000000805e18de82
[1517779.738701] Calculated CRC is bae60ada,  CRC in frame is d4faba0c, phys: 000000805691b402, 000000805691b402
-->

Considering that the system is running with 64K pages, the following statistics
can be drafted:

  * 29 pages are interested, most of them in the area 0x804c14-0x805f18. This
  is a range of +1300 pages, ~80MiB.
  * Among the 29 pages, three of them are located in a lower memory area 
    (0xe006, 0xe808, 0xec27).

```
      1 00000000e006          2 00000080563c          2 000000805da1
      1 00000000e808          3 000000805655          2 000000805e09
      1 00000000ec27          3 000000805657          3 000000805e0a
      4 000000804c14          3 00000080565b          1 000000805e0d
      4 000000804c7a          1 00000080565d          7 000000805e18
      4 0000008051da          1 00000080565f          1 000000805e1b
      2 0000008051dd          3 000000805682          2 000000805e1d
      2 000000805204          4 000000805691          1 000000805e1f
      1 000000805626          2 000000805695          2 000000805f18
      2 000000805636          5 000000805887
```

Now, the only way to rule out any possible memory corruption issue would be an
in-depth memory test pointed directly on those memory regions. `memtester` is 
actually capable of working directly on a range of physical addresses, by 
making use of /dev/mem, but this is really a bad idea as the underlying memory
pages are very likely to be in use by the kernel. In the best case, the tool would mistakenly 
report data corruption due to the concurrent activity of other threads, in the
worst case, the system would completely freeze. The proper course of action would
be to use bare-metal memory testing utilities like uboot `mtest`. 
At this point however, I decided to halt all the debugging activities as the 
memory corruption hypothesis seemed rather weak to me and the deadline I had set for
coming up with a solution had been reached. Time came to ask for support to the 
system integrator that supplied the systems
  

Conclusions
=======
After lengthy discussions with the system integrator, we were advised to try using 
optical transceivers (GBIC) for fiber cables rather than passive Direct Attached Copper. 
With some initial disappointment, this approach worked. The system was 
running fine at 10 Gbit/s with no data corruption whatsoever. Being used to passive 
copper, this idea unfortunately did not cross my mind. 
The optical transceiver basically handles the generation of light signals over
the fiber: for some reason, the PHY embedded on the Gigabyte board does 
not cope well with copper, and by shifting the signal handling 
responsibilities to an external module, the problem seems to be "patched". However, all the issues 
related to TCP checksum and Ethernet FCS are still relevant and for these to date unfortunately
I don't have an explanation . The optical transceiver does not add any layer with additional checksumming, 
therefore data corruption on the wire would still pose a serious problem.

