---
layout: post
title:  "Network data corruption on Gigabyte R120-P31 - Part 2"
date:   2016-08-19 21:00:00
categories: jekyll update
summary: "After investigating a data corruption issue encountered on a Gigabyte 
ARM64 R120-MP31 at the application, transport and link layer, I have performend some
tests aimed at validating an alternative hypotesis, i.e. data corruption happening
in system RAM. This post is being developed and it is not in its final state."
---

The hardare-software interface
=======
When an incoming frame is received on the 10 Gbit interface of the XGene-1,  the controller is capable
of mastering the bus and copying directly the data into system memory. The controller
maintains a hardware ring buffer of available DMAable memory regions where to copy
incoming frames. When the NIC runs out of regions, the hardware ring buffer is
refilled by the driver. The DMAable addresses are basically *sk_buff* allocated
with *netdev_alloc_skb_ip_align*. The function uses *kmalloc* to allocate 
a virtual addresses that is immediately mapped to a physical address. 
This is different than what normally happens when user space processes allocate 
memory via *malloc*: the kernel adds a particular mapping to the virtual address 
space of the process but a physical frame is not reserved until the first page fault.
In this case, however, the newly allocated address must be communicated straight 
away to the hardware which accesses system memory without going through the CPU MMU. 
For this reason, a mapping must be available since the very beginning. The device is
not always capable of DMAing directly to physical addresses. Usually there is IOMMU
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
Generic Receive Offload feature provided by the kernel that allows to merge 
TCP segments into single *sk_buff*. GRO is the receive counterpart of 
*tcp-segmentation-offload*, a feature of ethtool-enabled hardware that performs
hardware segmentation of outgoing TCP segment, splitting them up in smaller chunks. 
Both on the receive and transmit side, segmentation allows to send fewer *sk_buff* 
through the network stack, with a significant increase in performance. The following
is an brief example of the initial control path for incoming frames obtained with *ftrace*.

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
ring buffer point directly to the *data* field of the *sk_buff*s. A further hypothesis 
that I wanted to validate was whether corruption was happening when data was 
DMAed and subsequently read from memory due to faulty RAM.


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
*CONFIG_ARM64_ERRATUM_843419* in the kernel configuration to work around an 
"unsupported RELA" error when loading the module.


Results from the probe
=======

