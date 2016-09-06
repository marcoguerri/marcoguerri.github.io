---
layout: post
title:  "Network data corruption on Gigabyte R120-P31 - Part 2"
date:   2016-08-19 21:00:00
categories: jekyll update
summary: "After investigating a data corruption issue encountered on a Gigabyte 
ARM64 R120-MP31 at the application, transport and link layer, I have performed some
tests aimed at validating an alternative hypothesis, i.e. data corruption happening
in system RAM. This post is being developed and it is not in its final state."
---

The hardware-software interface
=======
When an incoming frame is received on the 10 Gbit interface of the XGene-1,  the controller is capable
of mastering the bus and copying directly the data into system memory. The controller
maintains a hardware ring buffer of available DMAable memory regions where to copy
incoming frames. When the NIC runs out of regions, the hardware ring buffer is
refilled by the driver. The DMAable addresses are basically *sk_buff* allocated
with *netdev_alloc_skb_ip_align*. This function uses *kmalloc* to allocate 
a virtual addresses that is immediately mapped to a physical one. 
When user space processes allocate  memory via *malloc* the kernel adds a particular 
mapping to the virtual address  space of the process but a physical frame is 
not reserved until the first page fault.
In this case, however, the newly allocated address must be communicated straight 
away to the hardware which accesses system memory without going through the CPU MMU. 
For this reason, a mapping must be available since the very beginning. Hardware devices are
not always capable of DMAing directly to physical addresses. There is usually IOMMU
hardware that translates addresses as seen by the device to physical ones:
the kernel allows to obtain a valid DMAble address for the device via the DMA API. 
In this case *dma_map_single* is used.

Retrieving frames from system RAM
=======
In the xgene-enet driver, the function responsible for retrieving frames that 
have been DMAed to memory is *xgene_enet_rx_frame*. This function is called
by the NAPI polling callback, *xgene_enet_napi*  registered by the driver upon 
initialization and it is basically responsible for the following operations:

  * it validates the incoming *sk_buff* checking for hardware I/O errors
  * it strips off the CRC 
  * it disables TCP checksum validation if already performed by the hardware
  * it updates RX counters
  * it passes the *sk_buff* to the upper layers of the stack via *napi_gro_receive*

By invoking the GRO receive function, the driver makes use of the 
Generic Receive Offload capabilities provided by the kernel that allow to merge 
TCP segments into single *sk_buff*. GRO is the receive counterpart of 
*tcp-segmentation-offload*, a feature of ethtool-enabled hardware that performs
hardware segmentation of outgoing TCP segments. Both on the receive and transmit side, 
segmentation allows to send fewer *sk_buff*  through the network stack, 
with a significant increase in performance while still transmitting on the wire
chunks of data sized in a way that can be easily handled by routers, switches, etc.
The following is an brief example of the initial control path for incoming frames obtained with *ftrace*.

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
ring buffers point directly to the *data* field of the *sk_buff*s. A further hypothesis 
I wanted to validate was whether corruption was happening when data was 
DMAed and subsequently read from memory due to faulty RAM (e.g. ECC errors).


Validating frames after DMA transfers
=======
In order to check whether *xgene_enet_rx_frame* was receiving data already corrupted
from system memory, I wrote some code that would perform the following steps:
    
  * Trap *xgene_enet_rx_frame*
  * Calculate the CRC and compare it with the one in the FCS field of the frame
  * Print the physical address of the frame upon detection of a mismatch in order
    to spot possible patterns or recurrent memory areas.

The implementation is based on a kernel *jprobe*, a Linux feature
that allows to assign a callback to a kernel function with the capability 
of inspecting the function's arguments. At the time of testing, the latest kernel version available 
(4.7.0) was not supporting officially jprobes for ARM64. Several implementations had already 
been circulated in the kernel mailing list, the latest one being from Sandeepa Prabhu 
on the 8th of July 2016 (*arm64: Kprobes with single stepping support*). 
This series of 10 patches cleanly applied against kernel 4.6.0 (aka 2dcd0af5), which is
the one I used for this experiment. As a side note, I had to disable
*CONFIG_ARM64_ERRATUM_843419* in the kernel configuration to work around a 
relocation error ("unsupported RELA") that was being raised when loading the module.


Results from the probe
=======
After having transferred around 5 GB of data coming from /dev/zero, there were
21 *sk_buff* for which the CRC could not be validated.

```
[1429112.141847] Calculated CRC is a2d36408,  CRC in frame is 8b925034, phys: 0000008059441b02, 0000008059441b02
[1429124.734079] Calculated CRC is af541ab8,  CRC in frame is 35bb8384, phys: 0000008059440a02, 0000008059440a02
[1429124.779804] Calculated CRC is b5169760,  CRC in frame is 22b1ff7b, phys: 0000008056607002, 0000008056607002
[1429156.658810] Calculated CRC is 9731232f,  CRC in frame is ceb0547f, phys: 00000000ec2a2382, 00000000ec2a2382
[1429194.443860] Calculated CRC is 7e84ece9,  CRC in frame is 49aed70b, phys: 0000008059440182, 0000008059440182
[1429293.466305] Calculated CRC is d168a9aa,  CRC in frame is b09764be, phys: 0000008056914582, 0000008056914582
[1429305.970368] Calculated CRC is 25dfe9b6,  CRC in frame is 7b5392d0, phys: 0000008056912c02, 0000008056912c02
[1429338.497401] Calculated CRC is 7dfa81c7,  CRC in frame is f9425f37, phys: 000000805640de82, 000000805640de82
[1429367.510559] Calculated CRC is db90052d,  CRC in frame is e070a4ed, phys: 0000008052052c02, 0000008052052c02
[1429436.927157] Calculated CRC is a312ca99,  CRC in frame is 18bdc290, phys: 00000080590dc502, 00000080590dc502
[1429462.237861] Calculated CRC is 1b855975,  CRC in frame is f6895477, phys: 000000805230bc82, 000000805230bc82
[1429484.245503] Calculated CRC is ba37b0de,  CRC in frame is 43b7f9dd, phys: 00000080590dab82, 00000080590dab82
[1429528.236024] Calculated CRC is 28cf29ee,  CRC in frame is 4019e4a0, phys: 000000805e0ade82, 000000805e0ade82
[1429532.481739] Calculated CRC is 7286d056,  CRC in frame is f68f7442, phys: 0000008056827882, 0000008056827882
[1429535.701872] Calculated CRC is 59ff0487,  CRC in frame is 50619d6d, phys: 0000008058872382, 0000008058872382
[1429584.127514] Calculated CRC is 169ae170,  CRC in frame is a626e1d, phys: 000000805e0a7882, 000000805e0a7882
[1429606.691764] Calculated CRC is baa7fc63,  CRC in frame is 625b2601, phys: 00000080597d7002, 00000080597d7002
[1429617.873490] Calculated CRC is 3f7b531d,  CRC in frame is c9c682fa, phys: 000000805914c502, 000000805914c502
[1429636.993778] Calculated CRC is 7e16a012,  CRC in frame is 14e829e9, phys: 000000805670cd82, 000000805670cd82
[1429660.829641] Calculated CRC is 93e5c42a,  CRC in frame is efb3ab24, phys: 0000008058870182, 0000008058870182
[1429661.196027] Calculated CRC is 23835a97,  CRC in frame is d98aeddd, phys: 0000008056850182, 0000008056850182
```

