---
layout: post
title:  "LVM disk backup"
date:   2015-08-17 08:00:00
published: no
categories: jekyll update
pygments: true
summary: "This post summarizes the backup procedure of a Linux installation based
on a boot partition and three LVM logical volumes for root, var and swap. This proves
useful when a Linux installation must be snapshotted and moved to a different machine
using the lowest possible amount of space."
---

Initial setup
=======
All the following commands refer to a RedHat Linux system. First off, *lvm2* package
needs to be installed. In this reference systems, the situation is the following:

* /dev/sda2 is a LVM physical volume partition
* /dev/sda1 is the boot partition

*vg1* is the only volume group present on the systems, consisting of the PV created on /dev/sda2.
The volume group must be activated.

{% highlight console lineos %}

[root@localhost tmp]# vgdisplay
  --- Volume group ---
  VG Name               vg1
  System ID
  Format                lvm2
  Metadata Areas        1
  Metadata Sequence No  5
  VG Access             read/write
  VG Status             resizable
  MAX LV                0
  Cur LV                4
  Open LV               0
  Max PV                0
  Cur PV                1
  Act PV                1
  VG Size               744.19 GiB
  PE Size               32.00 MiB
  Total PE              23814
  Alloc PE / Size       23814 / 744.19 GiB
  Free  PE / Size       0 / 0
  VG UUID               KrtTpl-QW87-nhDT-mROs-HTPq-6iFN-6QMjIf

[root@localhost tmp]# vgchange -a y vg1

{% endhighlight %}


Resizing filesystems
=======
Logical volumes should be shrinked to the minium size possible. Before doing so,
the filesystems must be resized. Each LV should be checked against the space occupied
and modified accordingly. The reference system contains the following LVs:


{% highlight console lineos %}
[root@localhost tmp]# lvdisplay  | grep Path
  LV Path                /dev/vg1/root
  LV Path                /dev/vg1/var
  LV Path                /dev/vg1/tmp
  LV Path                /dev/vg1/swap
{% endhighlight %}

/dev/vg1/var will be taken as a reference. Mount the LV and check how much space
is used on its filesystem.

{% highlight console lineos %}
[root@localhost tmp] mount /dev/vg1/var mnt
[root@localhost tmp]# df -h
Filesystem           Size  Used Avail Use% Mounted on
[...]
/dev/mapper/vg1-var  683G  1.8G  646G   1% /tmp/mnt
{% endhighlight %}

It's clear that there is a significant margin for resizing the filesystem. On ext filesystems, 
this can be done with *resize2fs* (e2fsprogs), which uses the filesystem blocksize 
as default unit (normally 4K for ext). One important point to notice is that 
the space reported by *df* is the usable space as seen by the user. The actual
minimum size, metadata included, of an ext filesystem is not that trivial to calculate:
as a reference, there is a detailed [article](http://www.tldp.org/HOWTO/Filesystems-HOWTO-6.html)
 on TLDP whic explains the structure of an ext2 filesystem. The structure basically
consists of block groups. Each block groups is divided as follows:

* Superblock
* FS descriptors
* Block bitmap
* inode bitmap
* Subset of the Inode table
* Data blocks

Taking into consideration all metadata requires an in-depth understanding of the fs.
resize2fs can help: in fact, this calculation is done by function *calculate\_minimum\_resize\_size* 
in [*resize/resize2fs.c*](http://git.kernel.org/cgit/fs/ext2/e2fsprogs.git/tree/resize/resize2fs.c#n2769). If resize2fs is invoked with a size which is lower than the minimum allowed,
it will complain showing the minimum possible size. Add a small margin and
proceed.

{% highlight console lineos %}

[root@localhost tmp]# resize2fs /dev/mapper/vg1-var 10K
resize2fs 1.41.12 (17-May-2010)
resize2fs: New size smaller than minimum (871426)

{% endhighlight %}

{% highlight console lineos %}
[root@localhost tmp]# e2fsck -f /dev/vg1/var
[root@localhost tmp]# resize2fs /dev/vg1/var 871450
resize2fs 1.41.12 (17-May-2010)
Resizing the filesystem on /dev/vg1/var to 871450 (4k) blocks.
The filesystem on /dev/vg1/var is now 871450 blocks long.

{% endhighlight %}


Resizing LVs
=======
Once the fs has been resized, the LV can also be shrinked.



