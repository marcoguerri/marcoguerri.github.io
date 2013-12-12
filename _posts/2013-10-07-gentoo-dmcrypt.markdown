---
layout: post
title:  "Gentoo full disk encryption with dm-crypt"
date:   2013-10-07 13:31:48
categories: jekyll update
---
These notes describe the process of installing a Gentoo Linux distribution with
encrypted root and swap partitions using LUKS and dm_crypt. Everything will
be done manually (Kernel compilation, creation of the initrd): the aim is therefore
to understand what happens under the hoods when you click the checkbox in the bottom
of a common disk partitioning menu during Linux installation.

<div align="center">
<a id="single_image" href="/assets/img/gentoo-enc/encrypt.png">
<img src="/assets/img/gentoo-enc/encrypt.thumb.png" alt=""/></a>
</div>
The procedure is more or less the same as the
one outlined in the [Gentoo Linux x86 Handbook](#gentoo_handbook). However, when it comes to
paritioning the drive, compiling the Kernel and setting the initial ramdisk,
several different steps must be carried out. 

I followed the whole process in a Virtual Machine, using VMWare Player as hypervisor.
The Gentoo live image used in these notes is the weekly build install-x86-minimal-20130820 
(sha256sum d3135b53770c9a5c8aed760fe5e8525ffd0fd9abc79509bcdca651e33327def2).
Working "remotely" through ssh is much more convenient. You need to generate ssh
keys, set a root password and start sshd daemon. The commands below generate
a new set of RSA/DSA keys.
{% highlight bash %}
livecd ~ # ssh-keygen -t rsa -C "gentoo-setup"
[...]
Enter file in which to save the key (/root/.ssh/id_rsa): /etc/ssh/ssh_host_rsa_key
[...]
livecd ~ # ssh-keygen -t dsa -C "gentoo-setup"
[...]
Enter file in which to save the key (/root/.ssh/id_rsa): /etc/ssh/ssh_host_dsa_key
[...]

{% endhighlight %}
The Gentoo Linux x86 Handbook can be followed up to step 4, which deals with hard
disk configuration. In this notes I will use /dev/sda both for boot and root
partitions.

First step: creating a plain primary boot partition with fdisk, /dev/sda1, and
formatting it with  a Unix-like filesystem. In this case I have chosen ext4. 
As far as the size is concerned, 256M are enough. To create the FS, mkfs.ext4 can be used.
{% highlight bash %}
mkfs.ext4 /dev/sda1
{% endhighlight %}
The second partition, which will be used to map two logical encrypted volumes
for root and swap, can take up all the space left on the device. After the
creation of the partitions, /dev/sda2 must be format to be a LUKS compliant
partition:
{% highlight bash %}
livecd ~ # cryptsetup --verify-passphrase luksFormat /dev/sda2
[...]
WARNING!
========
This will overwrite data on /dev/sda2 irrevocably.

Are you sure? (Type uppercase yes): YES
Enter LUKS passphrase: 
Verify passphrase: 
{% endhighlight %}
Now two logical volumes inside the encrypted partition must be set, one for root
and one for swap. To create logical volumes, the LVM framework will be used. 
First of all the encrypted partition must be opened and a mapping with a plain
device must be set up. This can be setup with the following command. 
{% highlight bash %}
livecd ~ # cryptsetup luksOpen /dev/sda2 vault
Enter passphrase for /dev/sda2:
{% endhighlight %}
At this point, the device mapper has created a /dev/mapper/vault device which is
the plain version of the encrypted disk. Now it is time to create logical
volumes for root and swap inside the encrypted partition. The LVM framework will
be used for this purpose. First step: creating a physical volume.
{% highlight bash %}
livecd ~ # pvcreate /dev/mapper/vault           
  Physical volume "/dev/mapper/vault" successfully created

{% endhighlight %}
Now actual logical volumes can be created. Here I will create a 4GB LV for swap
and a LV for root which will extend up to the end of the physical volume.
{% highlight bash %}
livecd ~ # lvcreate --size 4G --name swap vg
  Logical volume "swap" created
livecd ~ # lvcreate --extents 100%FREE --name root vg
  Logical volume "root" created
{% endhighlight %}
Now under /dev/mapper, the two LV that have just been created are available:
/dev/mapper/vg-root and /dev/mapper/vg-swap. It is time to create filesystems on
the LV. For swap:
{% highlight bash %}
livecd ~ # mkswap /dev/mapper/vg-swap 
Setting up swapspace version 1, size = 4194300 KiB
no label, UUID=8fd4d40a-617b-409d-a5e8-ec6bfe926cc5

livecd ~ # mkfs.ext4 /dev/mapper/vg-root 
mke2fs 1.42.7 (21-Jan-2013)
Filesystem label=
OS type: Linux
Block size=4096 (log=2)
Fragment size=4096 (log=2)
Stride=0 blocks, Stripe width=0 blocks
1032192 inodes, 4127744 blocks
206387 blocks (5.00%) reserved for the super user
First data block=0
Maximum filesystem blocks=4227858432
126 block groups
32768 blocks per group, 32768 fragments per group
8192 inodes per group
Superblock backups stored on blocks: 
    32768, 98304, 163840, 229376, 294912, 819200, 884736, 1605632, 2654208, 
    4096000

Allocating group tables: done                            
Writing inode tables: done                            
Creating journal (32768 blocks): done
Writing superblocks and filesystem accounting information: done
{% endhighlight %}
At this point, the Gentoo Handbook can be resumed from point 4.f

{% highlight bash %}
livecd ~ # mkdir /mnt/gentoo/
livecd ~ # mkdir /mnt/gentoo/boot
livecd ~ # mount /dev/sda1 /mnt/gentoo/boot
livecd ~ # swapon /dev/mapper/vg-swap 
livecd ~ # mount /dev/mapper/vg-root /mnt/gentoo/
{% endhighlight %}
After the precompiled filesystem has been downloaded and the chrooted environment
has been set, it is time to compile the kernel for the new system.  Kernel
source code can be retrieved through Portage, gentoo package manager.

{% highlight bash %}
livecd ~ # emerge gentoo-sources
{% highlight bash%}
The kernel sources version installed is *linux-3.10.7-gentoo-r1*. 
The configuration procedure is highly hardware dependend. Make sure to activate 
all the necessary modules to support the underlying hardware. A while ago, while 
I was working on a physical machine, I remember having problems with the SATA controller which was
supported by sata\_nv module (CONFIG\_SATA\_NV). Now, considering that I am working
on a virtual machine, the i386\_defconfig lacked these options:

* **CONFIG\_FUSION\_SPI** for LSI SCSI controller (which is the one emulated by VMPlayer)
* **CONFIG\_CRYPTO\_SHA256** to support SHA256 algorithm in kernel space
* **CONFIG\_DM\_CRYPT** to support dm\_cyrpt framework
* **CONFIG\_PCNET32** for network support (this is not strictly necessary to
set up the environtment)












References:<br>
<a name=gentoo_handbook> 
[1] [Gentoo Linux x86 Handbook](http://www.gentoo.org/doc/en/handbook/handbook-x86.xml?full=1)

[jekyll-gh]: https://github.com/mojombo/jekyll
[jekyll]:    http://jekyllrb.com

