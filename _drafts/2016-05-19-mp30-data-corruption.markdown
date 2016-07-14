---
layout: post
title:  "Data corruption over SFP+ interfaces on Gigabyte MP30-AR0"
date:   2016-06-19 21:00:00
categories: jekyll update
summary: "A summary of some steps I have gone through to debug a subtle data
corruption issue encountered on the ARM64 platform from Gigabyte MP30-AR0 "
---

Background
=======

After deploying and cabling two Gigabyte MP30-AR0 to a SFP+ switch, random failures 
were noticed during ssh connections, yum install commands etc. Everything seemed
to point to a data corruption issue, and a quick network test confirmed something was wrong.
On the client side (zsh needed):

{% highlight console %}
[root@client]~# loop=1; while [ $loop -eq 1 ]; do 
    dd if=/dev/zero bs=8K count=20480 2>&/dev/null | tee >(md5sum) | nc 10.41.208.28 8080; 
    if [ $? -ne 0 ]; then loop=0; fi; 
    done | uniq
f5ffba20ce077a9f789a61ff8aedb471  -
{% endhighlight %}

and on the server side:
{% highlight console %}
[root@mp30ar0 ~]# while [ 1 -eq 1 ]; do nc -l 8080 | md5sum; done  | uniq
f5ffba20ce077a9f789a61ff8aedb471  -
60e1904fda6b86ebdf703ed2b41c39f8  -
f5ffba20ce077a9f789a61ff8aedb471  -
{% endhighlight %}

Having a look at what was transferred when checksums did not match would
result in a dump similar to the one shown below (bear in mind, payload is coming from 
/dev/zero).

{% highlight console %}
[root@mp30ar0 ~]# hexdump data 
0000000 0000 0000 0000 0000 0000 0000 0000 0000
*
5f207f0 0000 0000 0000 0000 0000 0200 0000 0000
5f20800 0001 0008 0000 0000 0000 0000 0000 0000
5f20810 0000 0000 0000 0000 0000 0000 0000 0000
*
a000000
{% endhighlight %}

Definitely not good, bit flipped apparently at random. The time frame necessary for 
data corruption to appear varied. I had two boards between my hands: with the first 
it would be a matter of few seconds, with the second it would take longer than that, 
up to 2 minutes. After a bit of hacking I came to the conclusion that there 
seemed to be a pattern. A further example of corrupted payload is the following.

{% highlight console %}
[root@mp30ar0 ~]# hexdump data 
0000000 0000 0000 0000 0000 0000 0000 0000 0000
*
54a78b0 0800 0000 0000 0004 0020 0000 0000 0000
54a78c0 0000 0000 0000 0000 0000 0000 0000 0000
*
a000000
{% endhighlight %}

At first glance it looks different, but in fact the 3 bits are placed at the same
distances as in the first example. The existence of a pattern seemed to rule
out data corruption on the wire, but to have a clear picture of what was happening
at the different layers I decided to carry out some experiments

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
the problem top down and investigate everything that was happening starting
from the transport layer.



TCP checksum
=======
The first point I wanted to address was whether the segments that
were being delivered to userspace had valid TCP checksums. What usually happens on 
modern hardware is that checksum verification on the receiving side is offloaded to the NIC,
and if it can't be validated the whole frame is discarded straight away. Tools
like tcpdump or wireshark can be really useful in this case as they provide
information on the correctness of the checksum. The easiest way that came to mind to test
this use case was to develop a *netfilter* kernel module that would mangle outgoing
packets at layer 2, preventing somehow the NIC to recompute the checksum when
checksum offloading is enabled. Linux also provides ways to use a network scheduling
algorithm (or queue discipline) that corrupt outgoing packets. In particular,
the *netem* (Network Emulator) scheduler allows to perform randomized packet
corruption.

{% highlight console %}
sudo tc qdisc add dev lo root netem corrupt 10
{% endhighlight %}

However, there's not much space for tuning: with the line above what we are saying
is "corrupt 10% of the *sk_buff*, with corruption meaning the flip of one random
bit. The relevant code from *net/sched/sched_netem.c* which does the corruption 
is the following:


{% highlight C linenos %}
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
{% endhighlight %}

The most relevant parts are probably the call to *skb_checksum_help*, which computes
in software the checksum of the packet and sets *skb->ip_summed* to *CHECKSUM_NONE*,
which notifies the NIC that the checksum must not be recalculated in hardware. On
line 20 and 21, the packet that has been chosen for corruption has a random bit flipped
within the linear buffer of the sk_buff (i.e. modulo *skb_headlen()*. The paged data
of the sk_buff is not considered for the corruption (I guess to keep things simple).
\\
However, this tool did not provide enough control for the test I wanted to perform, hence the decision
to write a simple <a href="https://github.com/marcoguerri/packet-mangle" target="_blank">
netfilter kernel module</a>, which registers a callback to the *NF_INET_POST_ROUTING* hook.
The code acts in a very similar way as the netem discipline:

  * it for a specific pattern in the application level payload. Again for simplicity
    non-linear sk_buffs are ignored
  * it calculates the checksum before the corruption. The code operates at layer
    two just before the queue discipline, therefore the *sk_buff* is complete
  * it prints some debug information
  * it sets *skb->ip_summed* to *CHECKSUM_NONE* so that the checksum is not recalculated
    by the NIC





 



To remove the queue discipline
sudo tc qdisc del dev lo root

On the client side:
cat /dev/uraondom | tr -dc "[:alpha:]" or tr -dc  | LD_PRELOAD=./socket.so nc <server-ip> <port>

Then regularly asking it to dump statistics on the packets dropped
pgrep nc | tail -n 1 | xargs -I{} kill -SIGUSR1 {}

On the server simply nc -l 8080


{% highlight python linenos %}
#!/usr/bin/env python
{% endhighlight %}



Attempt with Gigabyte machine

Client
yes "A" | tr -d "\n"  | pv | head -c 1K | tee >(md5sum) | nc 10.41.208.23 8080
d47b127bc2de2d687ddc82dac354c415


Server
nc -l 8080 | md5sum 
d47b127bc2de2d687ddc82dac354c415

Mhh...Good, nothing out of ordinary, double check with hexdump
00000000  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|               
*                                                                                                       
0ee6b280 


Now, let's go higher
yes "A" | tr -d "\n"  | pv | head -c 1M | tee >(md5sum) | nc 10.41.208.23 8080
e6065c4aa2ab1603008fc18410f579d4

nc -l 8080 | md5sum
e6065c4aa2ab1603008fc18410f579d4


yes "A" | tr -d "\n"  | pv | head -c 100M | tee >(md5sum) | nc 10.41.208.23 8080
5937fb14ca678edd47fca8acbf0f12d0


nc -l 8080 | tee data | md5sum
5d01dcae3df8c7b5fbe24176c53f5202

Whhhat!

│00000000  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|
│*
│012441a0  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 01  |AAAAAAAAAAAAAAA.|
│012441b0  41 41 41 41 61 41 41 40  41 41 41 41 41 41 41 41  |AAAAaAA@AAAAAAAA|
│012441c0  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|
│*
│04871a70  41 41 41 41 41 41 41 41  41 41 41 41 41 41 40 41  |AAAAAAAAAAAAAA@A|
│04871a80  41 41 c1 41 41 45 41 41  41 41 41 41 41 41 41 41  |AA.AAEAAAAAAAAAA|
│04871a90  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|
│*
│05b031a0  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 51  |AAAAAAAAAAAAAAAQ|
│05b031b0  41 41 41 41 49 41 01 41  41 41 41 41 41 41 41 41  |AAAAIA.AAAAAAAAA|
│05b031c0  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|
│*
│06400000


Ouch! Not good!

So, on my client machiene checksumming seems to be offloadd to the NIC. In fact

rx-checksumming: on
tx-checksumming: on
        tx-checksum-ipv4: on
        tx-checksum-unneeded: off
        tx-checksum-ip-generic: off
        tx-checksum-ipv6: on
        tx-checksum-fcoe-crc: on [fixed]
        tx-checksum-sctp: on [fixed]

In fact, during any transfer, tcpdump tells me that the checksum is bad

21:40:18.203248 IP (tos 0x0, ttl 64, id 64408, offset 0, flags [DF], proto TCP (6), length 1500)
    10.41.208.11.57868 > 10.41.208.23.webcache: Flags [.], cksum 0xba43 (incorrect -> 0x0a4f), seq 17893377:17894825, ack 1, win 115, options [nop,nop,TS val 3396989079 ecr 6464754], length 1448
21:40:18.203254 IP (tos 0x0, ttl 64, id 64409, offset 0, flags [DF], proto TCP (6), length 1500)
    10.41.208.11.57868 > 10.41.208.23.webcache: Flags [.], cksum 0xba43 (incorrect -> 0x9b8d), seq 17894825:17896273, ack 1, win 115, options [nop,nop,TS val 3396989079 ecr 6464754], length 1448

Now, turn off tcp checksumming
[root@IT4183-RK015746-2 ~]# ethtool -K eth7 tx off

And everything will look much better

21:42:31.867663 IP (tos 0x0, ttl 64, id 215, offset 0, flags [DF], proto TCP (6), length 1500)
    10.41.208.11.57870 > 10.41.208.23.webcache: Flags [.], cksum 0x582d (correct), seq 16504625:16506073, ack 1, win 115, options [nop,nop,TS val 3397122743 ecr 6498170], length 1448
21:42:31.867674 IP (tos 0x0, ttl 64, id 216, offset 0, flags [DF], proto TCP (6), length 1500)
    10.41.208.11.57870 > 10.41.208.23.webcache: Flags [.], cksum 0xb520 (correct), seq 16506073:16507521, ack 1, win 115, options [nop,nop,TS val 3397122743 ecr 6498170], length 1448


Now, checksum offloading happens at the nic level, so if I add a queue discipline
before the nic then the checksum that will be calculated will be the correct one


So, on the destination machine, rx checksumming should be disabled
rx-checksumming: off [fixed]
tx-checksumming: on
        tx-checksum-ipv4: on
        tx-checksum-ip-generic: off [fixed]
        tx-checksum-ipv6: off [fixed]
        tx-checksum-fcoe-crc: off [fixed]
        tx-checksum-sctp: off [fixed]


Let's try to do something nasty
[root@IT4183-RK015746-2 ~]# tc qdisc add dev eth7 root netem corrupt 10

Then usual 
dd if=/dev/zero bs=512 count=5000 | nc 10.41.208.23 8080


Let's have a look at the server side....

00000000  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
*
000031b0  00 00 00 00 00 00 00 00  00 00 00 04 00 00 00 00  |................|
000031c0  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
*
00009ea0  00 00 00 00 00 00 00 00  20 00 00 00 00 00 00 00  |........ .......|
00009eb0  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
*
0000a690  00 00 00 00 00 04 00 00  00 00 00 00 00 00 00 00  |................|
0000a6a0  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
*
0000e6e0  00 00 01 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
0000e6f0  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
*
000148e0  00 00 00 00 00 00 20 00  00 00 00 00 00 00 00 00  |...... .........|
000148f0  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................

Wait, this data is definitely not /dev/zero, but it's not that corrupted as I would
have expected it to be.. In fact, let's see how many retransmit we have with tcpinfo.



So let's see how many segments it's retransmitting in normal conditions:

dd if=/dev/zero bs=512 | pv |  LD_PRELOAD=./socket.so nc 10.41.208.23 8080
pgrep "nc$" | xargs -I{} kill -SIGUSR1 {} more or less every second

Lost: 0, Retransmitted: 154
Lost: 0, Retransmitted: 163
Lost: 0, Retransmitted: 174
Lost: 0, Retransmitted: 185
Lost: 0, Retransmitted: 194
Lost: 0, Retransmitted: 203

Well, this is probably considered normal, it's around ~3 times higher than
the retransmission rate towards my laptop, but's. No, it's not normal,
it's transferring at 160 MB/s, when it should be transferring much faster! 

dd if=/dev/zero bs=512 | pv |  LD_PRELOAD=./socket.so nc 10.41.208.23 8080
tc qdisc add dev eth7 root netem corrupt 10

Something wrong here
Lost: 0, Retransmitted: 5
Lost: 0, Retransmitted: 6
Lost: 0, Retransmitted: 6
Lost: 0, Retransmitted: 7
Lost: 0, Retransmitted: 7
Lost: 0, Retransmitted: 7
Lost: 0, Retransmitted: 7


This actually seems to be the correct behavior in presence a correctly working
checksum check. At the receive end, most of the segments are dropped, TCP window
basically is not growing at all. In fact, what you see at the remote end is
just few MSS transmitted, not more. on the nc process of the client is see a
higher values just because it's writing in the buffers, but the sliding window
remain of the same size. Let's try to limit the wmem of the tcp socket,
at some point also on the client side it should hang.. yes's, I think this theory is
right, just check what the values with sysctl -w mean, in fact the client tells me
I have written 2.7MB but in reality only 4032 bytes of data have been transmitted.

