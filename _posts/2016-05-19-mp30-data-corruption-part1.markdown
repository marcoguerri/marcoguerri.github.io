---
layout: post
title:  "Network data corruption on Gigabyte R120-P31 - Part 1"
date:   2016-06-19 21:00:00
categories: jekyll update
summary: "In this post I have summed up some of the steps I have gone through to 
debug a subtle data corruption issue encountered on a Gigabyte ARM64 R120-MP31.
This first part covers integrity investigations at the transport layer (i.e.
TCP checksums) and at link layer (i.e. Ethernet CRC32)."
---

Background
=======

After deploying and cabling two Gigabyte R120-P31 on a SFP+ switch, random failures 
started to appear during daily operations. Everything seemed
to point to a data corruption issue, and a quick network test confirmed something was wrong:

```
[root@client]~# loop=1; while [ $loop -eq 1 ]; do 
    dd if=/dev/zero bs=8K count=20480 2>&/dev/null | tee >(md5sum) | nc 10.41.208.28 8080; 
    if [ $? -ne 0 ]; then loop=0; fi; 
    done | uniq
f5ffba20ce077a9f789a61ff8aedb471  -

[root@r120p31 ~]# while [ 1 -eq 1 ]; do nc -l 8080 | md5sum; done  | uniq
f5ffba20ce077a9f789a61ff8aedb471  -
60e1904fda6b86ebdf703ed2b41c39f8  -
f5ffba20ce077a9f789a61ff8aedb471  -
```

After ruling out the most obvious factors, I wrote a slightly more elaborated
<a href="https://github.com/marcoguerri/packet-mangle/tree/master/userspace" target="_blank">
script</a>
that would transfer a specific payload together with the corresponding checksum. Whenever
the checksum did not match, the server would write on the disk the corrupted data.
The dump of a payload coming from /dev/zero would look as follows:

```
[root@r120p31 ~]# hexdump data 
0000000 0000 0000 0000 0000 0000 0000 0000 0000
*
5f207f0 0000 0000 0000 0000 0000 0200 0000 0000
5f20800 0001 0008 0000 0000 0000 0000 0000 0000
5f20810 0000 0000 0000 0000 0000 0000 0000 0000
*
a000000
```

At first glance, there seemed to be bits flipped at random positions. The time necessary for 
data corruption to appear varied. I had two boards at my fingertips: with the first 
it was a matter of few seconds for the issue to appear, with the second it would take 
longer than that, up to 2 minutes. After a bit of hacking I came to the conclusion that there 
seemed to be a pattern. A further example was the following:

```
[root@r120p31 ~]# hexdump data 
0000000 0000 0000 0000 0000 0000 0000 0000 0000
*
54a78b0 0800 0000 0000 0004 0020 0000 0000 0000
54a78c0 0000 0000 0000 0000 0000 0000 0000 0000
*
a000000
```

The 3 bits flipped in the second dump are placed at the same
distances as in the first example. The existence of a pattern seemed to rule
out data corruption on the wire, but to have a clear picture of what was happening
at the different layers I decided to carry out some experiments.

TCP/IP and data integrity
=======
In the TCP/IP stack there are three main ways to ensure data integrity:

  * Frame check sequences (basically CRC32) at Layer 2
  * IP header checksum at layer 3 (this actually protects only the IP header)
  * TCP checksum at layer 4

Having corrupted data delivered to userspace means that an error has to go
through these checks undetected, which is very unlikely. It would make much
sense to start investigating from the FCS at layer 2, which is the one usually
completely out of the control of the software stack. However, I decided to approach
the problem top down, starting the investigation from the transport layer.



TCP checksum
=======
The first point I wanted to address was whether the segments that
were being delivered to userspace had valid TCP checksums. What usually happens on 
modern hardware is that checksum verification on the receiving side is offloaded to the NIC,
and if it can't be validated the whole frame is discarded straight away. Tools
like tcpdump or wireshark can be really useful in this case as they provide
information on the correctness of the checksum. The easiest way that came to mind to test
this use case was to develop a *netfilter* kernel module that would mangle outgoing
packets at layer 2 on the client side, preventing somehow the NIC to recompute the checksum when
offloading was enabled. Linux also provides ways to use a network scheduling
algorithm (or queue discipline) that corrupts outgoing packets. In particular,
the *netem* (Network Emulator) scheduler allows to perform randomized packet
corruption via *tc* command as follows

```
sudo tc qdisc add dev lo root netem corrupt <CORRUPTION RATE>
```

This methods does not give much room for tuning: with the line above what we are saying
is "corrupt \<CORRUPTION RATE\>% of the *sk_buff*", with corruption meaning flipping one random
bit. The relevant code from *net/sched/sched_netem.c* which does the corruption 
is the following:


```c
    if (q->corrupt && q->corrupt >= get_crandom(&q->corrupt_cor)) {
        if (skb_is_gso(skb)) {
            segs = netem_segment(skb, sch);
            if (!segs)
                return NET_XMIT_DROP;
        } else {
            segs = skb;
        }

        skb = segs;
        segs = segs->next;

        if (!(skb = skb_unshare(skb, GFP_ATOMIC)) ||
            (skb->ip_summed == CHECKSUM_PARTIAL &&
             skb_checksum_help(skb))) {
            rc = qdisc_drop(skb, sch);
            goto finish_segs;
        }

        skb->data[prandom_u32() % skb_headlen(skb)] ^=
            1<<(prandom_u32() % 8);
    }
```

The most relevant parts are probably the call to *skb_checksum_help*, which computes
in software the checksum of the packet and sets *skb->ip_summed* to *CHECKSUM_NONE*,
notifying the NIC that the checksum must not be recalculated in hardware. The packet 
singled out for corruption has a random bit flipped within the linear buffer of the 
sk_buff (i.e. modulo *skb_headlen()*). The paged data of the sk_buff is not considered 
for the corruption, I guess to keep things simple.
\\
This capability of the Linux kernel did not provide enough control for the test I wanted to perform, hence the decision
to write a simple <a href="https://github.com/marcoguerri/packet-mangle/tree/master/kernelspace" target="_blank">
netfilter kernel module</a>, which registers a callback to the *NF_INET_POST_ROUTING* hook.
The code acts in a very similar way as the netem discipline:

  * it looks for a specific pattern in the application level payload. 
    Again for simplicity non-linear sk_buffs are ignored. In my case the magic
    world being sought was "0xDEADBEEF".
  * it calculates the checksum of the outgoing *sk_buff* before the corruption. 
    The code operates at layer
    two just before the queue discipline, therefore the *sk_buff* is complete
  * it prints some debug information (e.g. the expected checksum)
  * it corrupts the checksum
  * it sets *skb->ip_summed* to *CHECKSUM_NONE* so that the checksum is not 
  recalculated by the NIC

This kernel module has been tested on CentOS 7 with kernel 3.10, it is not guardanteed
to work on any other kernel version. The outcome of this experiment was definitely 
interesting. On the client side, where the netfilter kernel module was running, 
I could see the following output:

```
[ 4255.255119] Linear data: 564
[ 4255.257251] TCP payload len is 512
[ 4255.257944] TCP header len is 20
[ 4255.265462] TCP checksum should be 0x75f6
[ 4255.269345] Corrupting checksum to 0xBEEF
```

The length of the linear length basically indicates how much non-paginated 
data the *sk_buff* contains. Follows the length of the TCP payload and header.
The module then prints the expected checksum of the outgoing segments and notifies
that the checksum is being corrupted to 0xBEEF. On the server side *tcpdump* shows, 
among others, the following incoming segment:

```
    10.41.208.7.44550 > 10.41.208.29.webcache: Flags [P.], cksum 0xbeef (incorrect -> 0x75f6
), seq 1:513, ack 1, win 229, options [nop,nop,TS val 3954650 ecr 151369], length 512
        0x0000:  4500 0234 17d4 4000 4006 6c79 0a29 d007  E..4..@.@.ly.)..
        0x0010:  0a29 d01d ae06 1f90 e817 4009 d567 3944  .)........@..g9D
        0x0020:  8018 00e5 beef 0000 0101 080a 003c 57da  .............<W.
        0x0030:  0002 4f49 dead beef 0000 0000 0000 0000  ..OI............
        0x0040:  0000 0000 0000 0000 0000 0000 0000 0000  ................
        [...]
```

The first 4 bytes of the payload correspond, as expected, to 0xDEADBEEF. The most
interesting information shown by tcpdump is the incorrect TCP checksum notification,
followed by the expected value *0x75f6*. 
This is exactly the output of the netfilter kernel module!
Considering that this segment makes it all the way to userspace, not just to layer 2,
the following question arises: who is supposed to stop the corrupted segment? 
The NIC or the software stack at layer 4? According to *ethtool*, TCP checksum 
of incoming segments is software's responsibility:

```
[root@r120p31 ~]# ethtool -k eth2 | grep -i checksum
rx-checksumming: off [fixed]
tx-checksumming: on
        tx-checksum-ipv4: on
        tx-checksum-ip-generic: off [fixed]
        tx-checksum-ipv6: off [fixed]
        tx-checksum-fcoe-crc: off [fixed]
        tx-checksum-sctp: off [fixed]
```

Now, the relevant code in the *xgene-enet* driver that handles the checksum
of incoming frames is the following:

```c
skb->protocol = eth_type_trans(skb, ndev);
if (likely((ndev->features & NETIF_F_IP_CSUM) &&
           skb->protocol == htons(ETH_P_IP))) {
        xgene_enet_skip_csum(skb);
}
```
with *xgene_enet_skip_csum* begin:

```c
static void xgene_enet_skip_csum(struct sk_buff *skb)                           
{                                                                               
        struct iphdr *iph = ip_hdr(skb);                                        
                                                                                
        if (!ip_is_fragment(iph) ||                                             
            (iph->protocol != IPPROTO_TCP && iph->protocol != IPPROTO_UDP)) {   
                skb->ip_summed = CHECKSUM_UNNECESSARY;                          
        }                                                                          
}                                                                               
```   

If the protocol of the incoming frame is IP, i.e. *ETH_P_IP*, and the NIC reports 
the *NETIF_F_IP_CSUM* flag, than *xgene_enet_skip_csum* is invoked. More conditions
must be met in order for the checksum to be skipped: the datagram must not be
a fragment or the datagram must be carrying something that is neither TCP nor UDP.
In this case, we have indeed a TCP segment, but the IP datagram is not fragmented,
therefore *ip_summed* is definitely set to *CHECKSUM_UNNECESSARY* and the checksum
never verified again. Now, that *ndev->features & NETIF_F_IP_CSUM* condition looks very
suspicious. Why is *NETIF_F_IP_CSUM* set, if the NIC is not checksumming incoming
segments? The flag is being set in function *xgene_enet_probe* in xgene-enet driver:

```
         ndev->features |= NETIF_F_IP_CSUM |
                           NETIF_F_GSO |
                           NETIF_F_GRO |
                           NETIF_F_SG;
```

This "misunderstanding" between software and hardware causes corrupted
data to go through to the application layer. It would be tempting to remove
*NETIF_F_IP_CSUM* from the features of the device and, as a matter of fact,
this would fix the data corruption issue until a TCP checksum collision, which is 
not so unlikely considering the algorithm for the TCP checksum is rather weak.
However, the XGene-1 NIC is expected to checksum incoming frame. Offloading 
the calculation to the software severely affect the maximum throughput of tof the
interface.


Ethernet CRC
=======
The lowest level of the stack where corrupted data
is likely to be discarded is at Layer 2. Ethernet frames carry a CRC32 code
calculated over Layer 2 payload. The CRC is appended at the end of each outgoing
frame and it is usually completely invisible to the software stack. In fact,
the NIC calculates the checksum just before transmitting on the wire
and at the receiving side the hardware validates it and eventually strips it off 
the data that is passed to the software stack. Clearly if the CRC check fails,
the frame is discarded. Bearing this in mind, if corruption happens on the medium, 
then it must be detected at Layer 2, unless unlikely collisions happen. 
At this point of the investigation it was not clear to me whether the corruption 
was really happening on the wire: if that was really the case, then the CRC check 
had to disregard those frames. 


To asses whether hardware CRC verification was
working properly, I wrote a <a href="https://github.com/marcoguerri/fcs_control">
litte tool</a> that allows to send Layer 2 frames with corrupted CRC. As mentioned
before, normally CRC calculation is the hardware's responsibility and it is 
completely out of the control of the software/driver. Crafting customs Ethernet frames
is very easy with *PF_PACKET* sockets. If used
with *socket_type* set to *SOCK_RAW*, then it is possible to pass to the driver
the complete layer 2 frame, including the header. However, even *PF_PACKET* sockets
do not prevent the NIC from appending the CRC. This is where
socket option *SO_NOFCS* comes to the rescue. *SO_NOFCS* is a very useful flag
that, when supported by the driver, tells the NIC not to add any frame
check sequence (i.e. CRC). The flag can be easily set with *setsockopt*  at
the *SOL_SOCKET* level. In case the driver does not support it, *setsockopt* 
returns *ENOPROTOOPT*.


Let's see an example of *SO_NOFCS* in action. The tool expects the interface
to be associated with the RAW socket and the destination MAC address. First a minor 
remark: in the following
examples, the MAC address being specified as destination MAC varies, even though
the machine/interface I am using for the tests is the same. In fact, the machine has two
SFP+ interfaces, and with the current UEFI firmware from AppliedMicro, version
1.1.0, the second SFP+ port is not detected at all. The MAC address of the first
interface varies depending on the version of the kernel. Normally it should be 
*fc:aa:14:e4:97:59*, and this is what kernel 4.2.0-29 is reporting, but under 
kernel 4.6.0, the interface with MAC address *fc:aa:14:e4:97:59* does not appear
to have any link anymore and the actual MAC address of the interface under test
magically becomes *22:f7:cb:32:eb:5c*. This is a very strange behaviour that
however is not present with the latest UEFI firmware from Gigabyte, despite
all the date corruption issue still being reproducible. It also true that, while 
running tcpdump on the server side, the NIC is in promiscuous mode and it will
accept anything, no matter the destination MAC, so the value specified on the
command line does not really matter.

If not explicitly requested, the tool appends a valid CRC at the end of the frame.
The minium frame size allowed by the 803.2 standard is 64 bytes. Considering
12 bytes for sender and receiver MAC, 2 bytes for protocol type and 4 bytes for
CRC, the minimum payload size is 46 bytes, which in this case is randomly generated.


```
[root@client]~# ./corrupt -i ens9f1 -m fc:aa:14:e4:97:59
Interface is ens9f1
Destination MAC address is fc:aa:14:e4:97:59
crc: d66bfef8
Message sent correctly
```

On the server the frame is received correctly, but clearly the CRC is not visible,
as it is stripped off by the NIC.

```
22:17:28.363202 aa:bb:cc:dd:ee:ff (oui Unknown) > fc:aa:14:e4:97:59 (oui Unknown), ethertype Unknown (0x1213), length 60: 
        0x0000:  568c 0682 43c7 02a0 fc06 b47f 359f 53fd  V...C.......5.S.
        0x0010:  aed0 9e1a c9ef 6169 19f2 5106 ab7d 6981  ......ai..Q..}i.
        0x0020:  8aee 044d b607 ee34 8c23 b341 43f8       ...M...4.#.AC.
```
Is there any way to have visibility over the CRC of incoming frames? Well,
normally the answer is no, the hardware simply removes it. However, this is
not always the case. In fact, on the XGene-1, the hardware actually passes the frame
check sequence over to the software stack and it is instead the driver's 
responsibility to strip it off. This is what happens in the *xgene_enet_rx_frame*
function, which is the NAPI polling function that handles the data which has been
DMAed to memory by the NIC (the following source code comes from the xgene-enet
driver shipped with kernel 4.6.0):

```c
        /* strip off CRC as HW isn't doing this */
        datalen = GET_VAL(BUFDATALEN, le64_to_cpu(raw_desc->m1));
        datalen = (datalen & DATALEN_MASK) - 4;
        prefetch(skb->data - NET_IP_ALIGN);
        skb_put(skb, datalen);
```

The CRC is being removed by subtracting the trailing 4 bytes from the total
lenght of the frame. Removing the *-4* easily does the trick as it can be seen
in the following trace (payload in now coming from /dev/zero):

```
10:13:53.697511 aa:bb:cc:dd:ee:ff (oui Unknown) > 22:f7:cb:32:eb:5c (oui Unknown), ethertype Unknown (0x1213), length 64: 
        0x0000:  0000 0000 0000 0000 0000 0000 0000 0000  ................
        0x0010:  0000 0000 0000 0000 0000 0000 0000 0000  ................
        0x0020:  0000 0000 0000 0000 0000 0000 0000 0ffe  ................
        0x0030:  979b
```
The message on the client side confirms the value of the CRC.

```
[root@client]~# ./corrupt -m 22:f7:cb:32:eb:5c -i ens9f1 
Destination MAC address is 22:f7:cb:32:eb:5c
Interface is ens9f1
crc: ffe979b
Message sent correctly
```

What happens if a corrupted CRC is appended to the frame? Normally any device
that operates at layer 2 is expected to drop it, which means that a corrupted
frame will never go past a switch or a NIC. However, at least for the latter,
there are ways around it: ethtool compliant driver/NICs expose the *rx-all* parameter, which when
supported and enabled, allows to receive all incoming frames, including those
whose CRC could not be validated. On the xgene-enet, rx-all is set to off,
as expected, and cannot be modified in any way. For the test to be meaningful,
client and server must be connected back-to-back, or the switch will drop any
corrupted data going through.
Considering the previous frame, with a payload of all zeros, we have seen that
the correct CRC is *0x0ffe979b*. If the tool appends a corrupted sequence, the result
on the server is the following:

```
11:02:57.186851 aa:bb:cc:dd:ee:ff (oui Unknown) > 22:f7:cb:32:eb:5c (oui Unknown), ethertype Unknown (0x1213), length 64: 
        0x0000:  0000 0000 0000 0000 0000 0000 0000 0000  ................
        0x0010:  0000 0000 0000 0000 0000 0000 0000 0000  ................
        0x0020:  0000 0000 0000 0000 0000 0000 0000 efbe  ................
        0x0030:  adde 
```
The frame is not discarded, even though the checksum is set to *0xdeadbeef*, which
is clearly not valid! As a side note, the CRC has been written on the frame as a 
little endian uint32_t, so that is the reason it appears reversed.

Conclusions
=======
The results of the experiments performed at application, transport and link have highlighted
the following issues:
    
  * Corrupted data is being delivered to userspace applications. 
  * The corruption happens both with a switched and back-to-back connection.
  * The corruption seems to follow a pattern, which most likely would rule out 
    data integrity issues on the medium (especially when the systems are connected
    back-to-back).
  * The device features reported by the driver include the *NETIF_F_IP_CSUM* flag.
   However, corrupted TCP checksums are not discarded by the NIC.
  * Corrupted link layer frames are not discarded by the NIC

The last point is probably the most critical one. Without a proper CRC integrity
check, it is hard to say whether the frame is being received on the wire already 
corrupted or bits are flipping at a later stage. Given the possible presence of 
a pattern in the corruption, an alternative explanation that came to mind envisioned
bits flipping when stored already in system RAM. In the second part of
this post I will report some notes concerning the investigation of this last hypothesis.