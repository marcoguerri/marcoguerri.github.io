---
layout: post
title:  "Linux containers, cgroups and namespaces "
date:   2016-02-23 15:28:23
categories: jekyll update
published: no
summary: "Some notes on the \"bare-metal\" operation of Linux container, focusing
on lxc and on the underlying Linux internal mechanisms, such as cgroups and
namespaces."

---


Setup of the machine
=======
All the steps below refer to a host system running Linux Debian 8.2.
*lxc* package is required to operate Linux containers in userspace.
This will install lxc templates under /usr/share/lxc/templates, which are
basically shell scripts that build the rootfs that will be mounted by the
container itself.


Creation of the container
=======
*lxc-debian* template allows to create a Debian container. This uses
*debootstrap* to to create a Debian based roots, which will be located in 
*/var/lib/lxc/\<CONTAINER-NAME\>/rootfs*.

```
sudo lxc-create -n DebianTestContainer -t /usr/share/lxc/templates/lxc-debian
```

The container can be started with *lxc-start*.

```
sudo lxc-start -d -n DebianTestContainer
```

This will start the container in background. With *lxc-debian* template, a getty 
is spawned on tty{1..4} and *lxc-console* can be used to connect to any of those
terminals with -t option (0 is the console, any other number is a tty).

```
sudo lxc-console -n DebianTestContainer -t 1

Connected to tty 1
Type <Ctrl+a q> to exit the console, <Ctrl+a Ctrl+a> to enter Ctrl+a itself

Debian GNU/Linux 8 DebianTestContainer tty1

DebianTestContainer login:
```

The newly created container is endowed only with a loopback interface. The network
subsystem can be customized at creation time with a configuration file deployed under
*/var/lib/lxc/\<CONTAINER-NAME\>/config*.


Networking
=======
The newly created container is endowed only with a loopback interface. The network
subsystem can be customized at creation time with the configuration file deployed under
*/var/lib/lxc/<CONTAINER-NAME>/config* and it is normally based on bridges and 
virtual ethernet devices.

Linux bridges
=======
Linux bridges are expose to userland as network devices whose job is to forward
traffic between two networks at Layer 2, i.e. based on hardware addresses (just
like a switch). Forwarding decisions are taken based on a table of MAC addresses 
that is filled in afterdiscovering which host is connected to which network. 
A software bridge is normally created to link a physical network interface to 
a virtual network interface belonging
to a virtual network. Once the bridge is up and running, the OS will reply to all 
ARP queries for MAC addresses belonging to the virtual network and will forward
incoming frames, via the bridge, to the virtual network. Under Debian, bridges
can be set up in several different ways:

* Via */etc/network/interfaces*
* Using *ip* command from iproute2
* Using *brctl* command (deprecated)

I will be using the second method. The following commands can be used to create
a bridge and add a physical interface.

```
ip link add name br0 type bridge
ip link set br0 up
ip link set eth0 master br0
```

*bridge link* shows the existing bridges and associated interfaces, while 
 *ip link del br0* removes the bridge. *br0* now appears among the network
 interfaces:

```
7: br0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default 
    link/ether 3c:97:0e:6e:e1:54 brd ff:ff:ff:ff:ff:ff
```
 
In the context of Linux containers, *br0* will be linking the physical interface 
of the host with the virtual interface assigned to the container. The immediate side 
effect of adding *eth0* to *br0* is a complete halt of network 
activity. When trying to ping the remote gateway for instance, *ip* reports the 
following neighbours (aka ARP table): 

```
192.168.0.1 dev eth0  INCOMPLETE
192.168.0.1 dev br0 lladdr fc:c8:97:b7:a2:74 REACHABLE
```

The MAC address of the default gateway appears to be associated with *br0* rather
then *eth0*. In fact, what happens when trying to reach the gateway is that the 
host keeps on broadcasting ARP requests for 192.168.0.1 via eth0, even though 
the response is correctly received, but associated with br0. 
Obviously when outgoing packets are routed through eth0, the ARP resolution is 
not available for layer 2 forwarding. This is the expected behavior
as eth0 is now an interface of the bridge (think, virtual switch), which
is supposed to do only layer 2 forwarding. Hence, the situation is the following:

  * *eth0* does not need an IP anymore, it's a dumb layer 2 interface
  * *eth0* must be removed as a routing interface towards any subnetwork
  * *br0* must be assigned an IP and used as default gateway on the host to access
  any of the bridged networks. As *eth0* is the master 
 interface of the bridge, the MAC of *eth0* and *br0* is shared
  * All the subnets that were routed through *eth0*, must now be routed
  through *br0*


This is summarized as follows:

```
➜ mguerri-lenovo ~ [] at 22:28:20 [Thu 25] $ sudo route -n
Kernel IP routing table
Destination     Gateway         Genmask         Flags Metric Ref    Use Iface
0.0.0.0         192.168.0.1     0.0.0.0         UG    0      0        0 eth0
0.0.0.0         192.168.0.1     0.0.0.0         UG    1024   0        0 eth0
192.168.0.0     0.0.0.0         255.255.255.0   U     0      0        0 eth0

➜ mguerri-lenovo ~ [] at 22:29:05 [Thu 25] $ sudo ip addr flush eth0
➜ mguerri-lenovo ~ [] at 22:29:11 [Thu 25] $ dhclient br0
➜ mguerri-lenovo ~ [] at 22:30:10 [Thu 25] $ sudo route del default
➜ mguerri-lenovo ~ [] at 22:36:16 [Thu 25] $ sudo ip route flush dev eth0

➜ mguerri-lenovo ~ [] at 22:36:21 [Thu 25] $ sudo route -n
Kernel IP routing table
Destination     Gateway         Genmask         Flags Metric Ref    Use Iface
0.0.0.0         192.168.0.1     0.0.0.0         UG    0      0        0 br0
169.254.0.0     0.0.0.0         255.255.0.0     U     1000   0        0 br0
192.168.0.0     0.0.0.0         255.255.255.0   U     0      0        0 br0
```

*br0* is now the entry point to all bridged networks. *brctl*
allows to list all the MACs that have been discovered by the bridge together
with the port on which they have been discovered.

```
➜  ~ [] at 22:45:33 [Thu 25] $ sudo brctl showmacs br0
port no mac addr        is local?   ageing timer
  1 00:1f:bc:0e:2c:b1   no         1.23
  1 3c:97:0e:6e:e1:54   yes        0.00
  1 70:10:6f:3e:18:72   no        21.06
  1 f8:32:e4:ea:bc:96   no         8.77
  1 fc:c8:97:b7:a2:74   no         0.84
```

Port 1 is indeed the subnet reachable via *eth0*:

```
➜  ~ [] at 22:56:21 [Thu 25] $ sudo brctl showstp br0
br0
[...]
eth0 (1)
[...]
```

