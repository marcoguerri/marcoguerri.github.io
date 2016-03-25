---
layout: post
title:  "Tales of mistery and PXE boot failures"
date:   2016-03-20 21:00:00
categories: jekyll update
published: yes
summary: "This a report of an interesting debugging session that followed an important
regression after the update of the network boot infrastructure at CERN to PXELINUX
6.03. It was an interesting dive into PXELINUX internals, down to the point where
it meets the hardware. The issues I was confronted with involved several different
layers of the infrastructure and therefore several different teams. As a consequence,
sometimes it was necessary to proceed with a limited amount of information and reduced
room for intervention, which made the whole process more fun."
---

Background and setup
=======
At some point at the beginning of 2016, given the increasing necessity to support
UEFI PXE boot, a decision was taken to upgrade the old PXELINUX 4
to PXELINUX 6.03. Everything went well, except that a relatively small subset of
machines could not PXE boot anymore after the upgrade (in legacy mode, as they had
always done in the past). It soon became clear that this regression was confined
to three flavors of machines, using three specific NICs: Chelsio T520-LL-CR,
Mellanox ConnectX-2 and QLogic cLOM8214. The symptoms were not really pointing
anywhere. The ROM of the NIC was correctly initializing the stack, going through
the whole DHCP discover, offer, request, ACK workflow, and it was finally loading
correctly pxelinux image from the server, which was then being given control.
PXELINUX initial banner was displayed and after a long delay, a timeout message
would appear: "Failed to load ldlinux.c32". And then a reboot.

<p align="center">
<a id="single_image" href="/img/pxe_timeout.png"><img src="/img/pxe_timeout.png" alt=""/></a>
</p>


The components involved
------
The infrastructure for PXE boot involves several components: clearly, a NIC,
with its PXE-compliant firmware, a DHCP server, a TFTP server, a PXE implementation
that does the heavy lifting, that is, loading and booting the kernel and initrd,
and the network in between the clients/servers. My team (Data Centre hardware)
was involved as it was clear that the issue was confined to specific NIC types.
At first, I was skeptical that any useful debugging could happen. The situation
was basically the following:

* No control over the network infrastructure
* No control over firmware of the NIC (at least, not the untar-vim-Make-flash
kind of control)
* No control over the DHCP server
* No control over the TFTP server
* Well, I could recompile PXELINUX, yes
* All the freedom to change kernel/initrd, but that was already at stage of the
process far too advanced.

Anyway, if you don't have a dog, you go hunt with the cat. At a second thought,
some of these hurdles could be overcome without too much effort. After deciding
to focus on the first instance of the failure, the Chelsio T520-LL-CR, I set out
on a journey that turned out very interesting.


A quick look at the network
------
The first approach that I tried was to dump the network traffic, in case something
obvious would turn up. I could not dump the traffic on the machine itself during
PXE boot, and dumping at the other end of the communication was not a good idea
either, so I asked the network team to set up port mirroring towards a host over
which I had complete control. It worked well, mixed up with tons of non relevant
traffic I could see my client loading pxelinux image and then going radio silence.
Here I made the first assumption, that unfortunately turned out to be wrong later on:
after relinquishing control to pxelinux, there is no network activity whatsoever.

DHCP/TFTP servers
------
The following piece that I needed was my own DHCP/TFTP infrastructure, so that
I could bypass the official servers and point directly to my test instances where
I could deploy a custom pxelinux. This also turned out doable. What was necessary was
the following:

* Setting up a DHCP/TFTP server
* Adding the DHCP server to a list that would be taken into consideration by
the DHCP Relays when routing DHCP traffic (you need a good reason to be in that
list!)
* Disabling any kind of DHCP answer from the official servers
* Configuring my own DHCP instance to provide an answer for the host under
test, pointing to the test TFTP server and custom pxelinux.

Once the test environment was in place, the debugging could start.



Interaction with the machine
------
Another import point to address was the interaction with the machine under test.
The system I used was part of a quad enclosure installed in a water cooled rack
in the Data Centre. Clearly, you don't want to stand there with your keyboard/monitor
for long time, as the noise, heat, air exhausted by the systems, all contribute
to make the experience very tiring. The obvious way to proceed was to use KVM over
IP, in order to have complete control over the system, and to perform power
management operations via IPMI. With such a setup, I didn't have to leave the office
for a second :).


Deploying the correct binary
------
pxelinux is part of syslinux project and it comes in two different flavors:
*pxelinux.0* and *lpxelinux.0*.
For the remainder of this experiment, the following remarks apply:

* I was compiling and testing the 32bits version of pxelinux
* I was working on git commit 138e850f

The first binary that I tried to deploy with my test environment was pxelinux.0,
and this worked flawlessly, I could boot without any problem. With lpxelinux.0 instead, the
behavior was identical to the production version: "Failed to load ldlinux.c32",
and reboot. My understanding of the difference between the two was very limited, but
idea is the following:

* lpxelinux.0 natively supports HTTP and FTP transfers by integrating
a full-fledged TCP/IP stack, lwIP, therefore interacting with the NIC only to 
transmit/receive layer 2 frames. 
* pxelinux relies instead on something else to implement network communication,
therefore having to provide only application level payloads (or probably only 
data structures correctly populated as required by the PXE standard).


Getting started...
=======

Now, with a working setup, and knowing more or less what I was after, It was just
a matter of digging down enough...


Debug messages
------
A good point where to start was where the error message itself was raised.
A quick grep pointed to *./core/elflink/load_env32.c*, function load_env32. 

{% highlight C %}
    writestr("\nFailed to load ");
    writestr(LDLINUX);
{% endhighlight %}

<i>This function starts the ELF module subsystem, by first trying to load the dynamic 
linker, ldlinux.c32, which is normally deployed on the TFTP server. This is consistent 
with the network traffic trace: the first time ldlinux tries to access the network, 
for some reason it fails and eventually it times out.</i>

Something that I clearly needed was debug messages, enabling those already present and adding more, if needed. 
*writestr* didn't seem something I could use: it was printing directly to the video buffer, 
but it didn't support format strings. *dprintf*, however, seemed to be more suitable
for the job. But what does dprinf do? By default, it is defined as vdprintf, and
a quick look at the code revealed that I could not expect messages coming up on
the KVM....

{% highlight C %}
    /* Initialize the serial port to 115200 n81 with FIFOs enabled */ 
    outb(0x83, debug_base + LCR);                                                  
    outb(0x01, debug_base + DLL);                                                  
    outb(0x00, debug_base + DLM); 
    [...]
{% endhighlight %}


Yay, serial port! It turns out that *DEBUG_STDIO* can be enabled to redefine dprintf
as printf, having debug messages written directly on the video buffer. In my case,
serial port was actually good enough, I could easily copy/paste, which would
have been more difficult with KVM. Clearly, it was not my intention to go
down in the machine room and plug any connector to the machine. Again, modern
BMCs can redirect traffic on serial port on the network via Serial Over Lan. So,

* SOL activated  
{% highlight console %}
ipmitool -H <BMC_HOSTNAME> -I lanplus -U <USERNAME> -P <PASSWORD> sol payload enable <LANCHANNEL> <USER_ID>
ipmitool -H <BMC_HOSTNAME> -I lanplus -U <USERNAME> -P <PASSWORD> sol activate
{% endhighlight %}

* Debug messages enabled in core/Makefile adding a couple of CFLAGS: *-DDEBUG_PORT=0x3f8* *-DCORE_DEBUG=1*
(there might have been a better way to do this...)

{% highlight console %}
    CFLAGS += -D__SYSLINUX_CORE__ -D__FIRMWARE_$(FIRMWARE)__ \
              -I$(objdir) -DLDLINUX=\"$(LDLINUX)\" 
              -DDEBUG_PORT=0x3f8 -DCORE_DEBUG=1
{% endhighlight %}
* Serial console redirection disabled in the BIOS, to avoid too much noise on the 
SOL

Deploy, reboot and fingers crossed..

{% highlight console %}
 inject: 0x579d0 bytes @ 0x00022a30, heap 1 (0x0018c2b8)
 start = 510, len = 79ef0, type = 1start = 100000, len = 7d206000, type = 1will inject a block start:0x3a1000 size 0x7cf65000inject: 0x7cf65000 bytes @ 0x003a1000, heap 0 (0x0018c280)
 start = 7d306000, len = 1beb000, type = 2start = 7eef1000, len = 116000, type = 2start = 7f007000, len = 228000, type = 2start = 7f22f000, len = e1000, type = 2start = 7f310000, len = 4f0000, type = 2start = 80000000, len = 10000000, type = 2start = fed1c000, len = 24000, type = 2start = ff000000, len = 1000000, type = 2
 PXELINUX 6.04 lwIP 6.04-pre1-1-g138e850* Copyright (C) 1994-2015 H. Peter Anvin et al
 !PXE entry point found (we hope) at 8EBD:00FA via plan A
 UNDI code segment at 8EBD len 3E0F
 UNDI data segment at 8468 len A550
 UNDI: baseio 0000 int 11 MTU 1500 type 1 "DIX+802.3" flags 0x0
 [...]
{% endhighlight %}

<i>Annuntio vobis gaudium magnum: Habemus debug messages</i> (tons of them)!
So, I though a good idea was to start from *load_env32*. I tried to follow the control
path, keeping an eye open for something that could be the root cause of the 
failure to load ldlinux.c32 from the network. After some flawless execution, 
the following is the path that seemed relevant to me.
relevant

{% highlight console %}
start_ldlinux
 _start_ldlinux
  findpath [./com32/lib/sys/module/common.c]
   fopen


{% endhighlight %}


















