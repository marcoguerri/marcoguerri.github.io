---
layout: post
title:  "LVM disk backup"
date:   2015-08-17 08:00:00
published: yes
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
 on TLDP which explains the structure of an ext2 filesystem. The structure basically
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
This roughly corresponds to 3.3GB. Add some margin and resize the LV


{% highlight console lineos %}

[root@localhost tmp]# lvreduce --size 5G /dev/vg1/var
  WARNING: Reducing active logical volume to 5.00 GiB
  THIS MAY DESTROY YOUR DATA (filesystem etc.)
Do you really want to reduce var? [y/n]: y
  Size of logical volume vg1/var changed from 693.16 GiB (22181 extents) to 5.00 GiB (160 extents).
  Logical volume var successfully resized

{% endhighlight %}

Check that the LV still mounts correctly and that the sizes are in line with the 
above. The swap filesystem is a special case, as it can be shrinked straight away
provided a new swap filesystem is crated afterwards on the LV.


{% highlight console lineos %}

[root@localhost tmp]# lvreduce --size 1G /dev/vg1/swap
  WARNING: Reducing active logical volume to 1.00 GiB
  THIS MAY DESTROY YOUR DATA (filesystem etc.)
Do you really want to reduce swap? [y/n]: y
  Size of logical volume vg1/swap changed from 31.47 GiB (1007 extents) to 1.00 GiB (32 extents).
  Logical volume swap successfully resized

[root@localhost tmp]# mkswap /dev/vg1/swap

{% endhighlight %}

Now the situation is the following:
{% highlight console lineos %}
[root@localhost tmp]# lsblk
[...]
sda                       8:0    0 745.2G  0 disk
├─sda1                    8:1    0     1G  0 part
└─sda2                    8:2    0 744.2G  0 part
  ├─vg1-root (dm-2)     253:2    0   9.8G  0 lvm
  ├─vg1-var (dm-3)      253:3    0     5G  0 lvm
  ├─vg1-tmp (dm-4)      253:4    0   9.8G  0 lvm
  └─vg1-swap (dm-5)     253:5    0     1G  0 lvm
{% endhighlight %}

Now comes the hard part. The LVs occupy around 30GB altogether, therefore the
physical volume should be resized accordingly. However, this operation is not immediately
straightforward because the physical extents (PE) which map the logical extends (LE) could
be located anywhere on the physical volume. The physical extents must be therefore
shrinked together and moved at the beginning of the physical volume. 
It's first necessary to verify how many PE are used and how these are mapped on 
the PV.


{% highlight console lineos %}
[root@localhost tmp]# pvdisplay | grep Allocated
    Allocated PE          818


[root@localhost tmp]# pvs -v --segments /dev/sda2
    Using physical volume(s) on command line.
    Wiping cache of LVM-capable devices
    Finding all volume groups.
  PV         VG   Fmt  Attr PSize   PFree   Start SSize LV   Start Type   PE Ranges
  /dev/sda2  vg1  lvm2 a--  744.19g 718.62g     0   313 root     0 linear /dev/sda2:0-312
  /dev/sda2  vg1  lvm2 a--  744.19g 718.62g   313   160 var      0 linear /dev/sda2:313-472
  /dev/sda2  vg1  lvm2 a--  744.19g 718.62g   473 22021          0 free
  /dev/sda2  vg1  lvm2 a--  744.19g 718.62g 22494   313 tmp      0 linear /dev/sda2:22494-22806
  /dev/sda2  vg1  lvm2 a--  744.19g 718.62g 22807    32 swap     0 linear /dev/sda2:22807-22838
  /dev/sda2  vg1  lvm2 a--  744.19g 718.62g 22839   975          0 free

{% endhighlight %}

This case is rather easy: PEs from 22494 to 22838 (345 PEs) are allocated for tmp 
and swap. These should be moved right after var, starting from PE 473 until 817.
This operation can be accomplished with *pvmove* command, and should lead to 
the following situation.

{% highlight console lineos %}
pvmove --alloc anywhere /dev/sda2:22494:22838 /dev/sda2:473-817

[root@localhost tmp]# pvs -v --segments /dev/sda2
    Using physical volume(s) on command line.
    Wiping cache of LVM-capable devices
    Finding all volume groups.
  PV         VG   Fmt  Attr PSize   PFree   Start SSize LV   Start Type   PE Ranges
  /dev/sda2  vg1  lvm2 a--  744.19g 718.62g     0   313 root     0 linear /dev/sda2:0-312
  /dev/sda2  vg1  lvm2 a--  744.19g 718.62g   313   160 var      0 linear /dev/sda2:313-472
  /dev/sda2  vg1  lvm2 a--  744.19g 718.62g   473   313 tmp      0 linear /dev/sda2:473-785
  /dev/sda2  vg1  lvm2 a--  744.19g 718.62g   786    32 swap     0 linear /dev/sda2:786-817
  /dev/sda2  vg1  lvm2 a--  744.19g 718.62g   818 22996          0 free


{% endhighlight %}

At this point it would be a good idea to check that the logical volumes can still
be mounted and that e2fsck does not report any problem. We have now 818 PE allocated
which roughly corresponds to 25GB


{% highlight console lineos %}
[root@localhost tmp]# pvdisplay  | grep Size
  PV Size               744.21 GiB / not usable 24.00 MiB
  PE Size               32.00 MiB

[root@localhost tmp]# echo "scale=2;818\*32/1024" | bc -l
25.56
{% endhighlight %}

The PV can be resized taking into consideration a safety margin.

{% highlight console lineos %}
[root@localhost tmp]# pvresize --setphysicalvolumesize 30G /dev/sda2
  Physical volume "/dev/sda2" changed
  1 physical volume(s) resized / 0 physical volume(s) not resized
{% endhighlight %}


Resizing the partition
=======

The partition /dev/sda2 now occupies much more space than it's necessary for the 
physical volume. It can be therefore resized accordingly. This step is very critical
and needs much attention. *fdisk* shows the information concerning the current partition

 
{% highlight console lineos %}
   Device Boot      Start         End      Blocks   Id  System
/dev/sda1   *           1         131     1048576   83  Linux
Partition 1 does not end on cylinder boundary.
/dev/sda2             131       97282   780361728   8e  Linux LVM
{% endhighlight %}

The unit used by fdisk is cylinders, in this case corresponding to ~7.84MiB. The
partition must be deleted and recreated with the same starting sector. Let's say
that the new partition must be at least of 35GB, ~4571 cylinders. After creating
the new partition, remember to set the partition type to LVM with fdisk. After 
creating the new partition, I have the following situation.

{% highlight console lineos %}
[root@localhost tmp]# parted -l
Model: ATA INTEL SSDSC2BB80 (scsi)
Disk /dev/sda: 800GB
Sector size (logical/physical): 512B/4096B
Partition Table: msdos

Number  Start   End     Size    Type     File system  Flags
 1      1049kB  1075MB  1074MB  primary  ext4         boot
 2      1075MB  39.1GB  38.0GB  primary

{% endhighlight %}

To obtain a compressed image of the disk, proceed deactivating the logical volumes
and dumping ~40GB from /dev/sda.


{% highlight console lineos %}
vgchange -a n vg1
dd if=/dev/sda conv=sync bs=128K count=328000| gzip -c  > /tmp/sda.img.gzip
{% endhighlight %}

I obtained a 14GB image, with more careful roundings, the compression ratio can
be improved significantly. To test the restore procedure, the image can be simply 
rewritten on the disk.


{% highlight console lineos %}
[root@localhost tmp]# dd if=/dev/zero of=/dev/sda
29973169+0 records in
29973169+0 records out
15346262528 bytes (15 GB) copied, 25.5131 s, 602 MB/s

[root@localhost tmp]# dd if=<(gunzip -c -d sda.img.gzip) of=/dev/sda conv=sync bs=4M  
[root@localhost tmp]# reboot

{% endhighlight %}

If everything went well, the system should boot into exact same system as before.
