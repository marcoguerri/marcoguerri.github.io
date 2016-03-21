---
layout: post
title:  "Tales of mistery and PXE boot failures"
date:   2016-03-20 21:00:00
categories: jekyll update
published: no
summary: "This a report of an interesting debugging session that followed a major
regression after the update of the network boot infrastructure at CERN to PXELINUX
6.03. It was an interesting dive into PXELINUX internals, down to the point where
it meets the hardware. The issues I was confronted with involved several different
layers of the infrastructure and therefore several different teams. As a consequence,
sometimes it was necessary to proceed with a limited amount of information and reduced
room for intervention, which kind of made the whole process more fun."
---

Background
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


The pieces involved
=======
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
on a journey that turned out extremely interesting. 


First: the network
=======
The first approach that I tried was to dump the network traffic, in case something 
obvious would turn up. I could not dump the traffic on the machine itself during
PXE boot, and dumping at the other end of the communication was not a good idea 
either, so I asked the network team to set up port mirroring towards a host over 
which I had complete control. It worked well, mixed up with tons of non relevant
traffic I could see my client loading pxelinux image and then going radio silence.
Here I made the first assumption, that unfortunately turned out to be wrong later on:
after relinquishing control to pxelinux, there is no network activity whatsoever.

Second: DHCP/TFTP
=======
The following piece that I needed was my own DHCP/TFTP infrastructure, so that 
I could bypass the official servers and point directly to my test instances where
I could deploy a custom pxelinux. This also turned out doable. What was necessary was
the following:

* Setting up a DHCP/TFTP server
* Adding the DHCP server to a list that would be taken into consideration by
the DHCP Relays when routing DHCP traffic (you need a good reason to be in that 
list :) ) 
* Disabling any kind of DHCP answer from the official servers
* Configuring the "underground" machines to provide an answer for the host under
test, pointing to the test tftp server and custom pxelinux.





















