---
layout: post
title:  "Dumping LVM volumes for debugging purposes"
date:   2015-08-17 08:00:00
published: yes
categories: jekyll update
pygments: true
summary: "This post presents a possible procedure to "snapshot" a Linux installation based
on a boot partition and three LVM logical volumes for root, var and swap. This proves
useful when an identical environment must be reproduced on a different machine
sharing the same hardware configuration but without network connectivity. One 
of the requirements is to obtain the smallest possible "image", so that it can
be easily transferred and rewritten on the second machine. Such a procedure does entail
a number of issues: all the machine specific parameters (e.g. /etc/hostname, MAC
addresses in /etc/sysconfig/network-scripts) are deployed to the second machine
and need to be adapted accordingly (not covered in this post). Bearing this in mind, 
all the following commands have been executed from a live image based on RedHat Linux."
---

Initial setup
=======
First off, *lvm2* package needs to be installed. In this reference systems, the 
situation is the following:

* /dev/sda2 is the partition which is hosting a LVM physical volume
* /dev/sda1 is the boot partition

vg1 is the only volume group on the system, consisting of the PV created on /dev/sda2.
The volume group must be first activated with *vgchange*.

```text
[root@localhost tmp]# vgchange -a y vg1
```


Resizing filesystems
=======
All logical volumes created on top of vg1 must be shrunk to the minimum size 
possible, but before doing so, the filesystems need to be resized. The test system 
contains four LVs. The notes that follow will take /dev/vg1/var as a reference.

```text
[root@localhost tmp]# lvdisplay  | grep Path
  LV Path                /dev/vg1/root
  LV Path                /dev/vg1/var
  LV Path                /dev/vg1/tmp
  LV Path                /dev/vg1/swap
```

*df* shows the available space on the LV as seen from userspace:

```text
[root@localhost tmp] mount /dev/vg1/var mnt
[root@localhost tmp]# df -h
Filesystem           Size  Used Avail Use% Mounted on
[...]
/dev/mapper/vg1-var  683G  1.8G  646G   1% /tmp/mnt
```

There is clearly a significant margin of unused space on *vg1/var* and
*resize2fs*, from *e2fsprogs*, can be used to find out the minimum allowed size of 
the ext filesystem on top of it. It is important
to notice that resize2fs uses the filesystem blocksize as default unit (normally 4K for ext),
and that the space reported by *df* is the usable space as seen by the user. The actual
minimum size, metadata included, of an ext filesystem is not trivial to calculate:
there is a detailed [article](http://www.tldp.org/HOWTO/Filesystems-HOWTO-6.html)
 on TLDP which covers the layout of ext2. The structure basically
consists of block groups, each one being divided as follows:

* Superblock
* FS descriptors
* Block bitmap
* inode bitmap
* Subset of the Inode table
* Data blocks

Taking into consideration all contributions of the metadata requires an in-depth 
understanding of the filesystem, but resize2fs comes to the rescue. In fact, 
this calculation is done by function *calculate\_minimum\_resize\_size* 
in [*resize/resize2fs.c*](http://git.kernel.org/cgit/fs/ext2/e2fsprogs.git/tree/resize/resize2fs.c#n2769).
If resize2fs is invoked with a command line argument  which is lower than the value returned
by *calculate\_minimum\_resize\_size*, it raises an error followed by the minimum 
allowed size of the filesystem, as the number of 4K blocks. To this value, I usually
add a small safety margin.

```text
[root@localhost tmp]# resize2fs /dev/mapper/vg1-var 10K
resize2fs 1.41.12 (17-May-2010)
resize2fs: New size smaller than minimum (871426)
[root@localhost tmp]# e2fsck -f /dev/vg1/var
[root@localhost tmp]# resize2fs /dev/vg1/var 871450
resize2fs 1.41.12 (17-May-2010)
Resizing the filesystem on /dev/vg1/var to 871450 (4k) blocks.
The filesystem on /dev/vg1/var is now 871450 blocks long.
```
This roughly corresponds to 3.3GB. 


Resizing the LVs
=======
The LV can be resized accordingly. The procedure outlined so far applies to all
the LVs, with the exception of the swap volume.

```text
[root@localhost tmp]# lvreduce --size 5G /dev/vg1/var
  WARNING: Reducing active logical volume to 5.00 GiB
  THIS MAY DESTROY YOUR DATA (filesystem etc.)
Do you really want to reduce var? [y/n]: y
  Size of logical volume vg1/var changed from 693.16 GiB (22181 extents) to 5.00 GiB (160 extents).
  Logical volume var successfully resized
```

The swap filesystem is a special case, as the underlying LV can be shrunk straight 
away and a new swap filesystem created on top.

```text
[root@localhost tmp]# lvreduce --size 1G /dev/vg1/swap
  WARNING: Reducing active logical volume to 1.00 GiB
  THIS MAY DESTROY YOUR DATA (filesystem etc.)
Do you really want to reduce swap? [y/n]: y
  Size of logical volume vg1/swap changed from 31.47 GiB (1007 extents) to 1.00 GiB (32 extents).
  Logical volume swap successfully resized
[root@localhost tmp]# mkswap /dev/vg1/swap
```

Modifying the mapping of the Extents
=======
The situation after resizing the LVs is the following: 

```text
[root@localhost tmp]# lsblk
[...]
sda                       8:0    0 745.2G  0 disk
├─sda1                    8:1    0     1G  0 part
└─sda2                    8:2    0 744.2G  0 part
  ├─vg1-root (dm-2)     253:2    0   9.8G  0 lvm
  ├─vg1-var (dm-3)      253:3    0     5G  0 lvm
  ├─vg1-tmp (dm-4)      253:4    0   9.8G  0 lvm
  └─vg1-swap (dm-5)     253:5    0     1G  0 lvm
```

The LVs occupy around 30GB altogether, hence the underlying physical volume could be 
resized to match this value with the usual safety margin. Unfortunately, this operation 
is not immediately straightforward because the physical extents (PE) which map 
the logical extends (LE) are normally fragmented throughout the whole physical 
volume. *pvresize* will refuse to shrink the physical volume if there are extends
allocated beyond the point where the new end would be. The documentation however
states that future versions of lvm2 will support automatic relocation, so this workflow
might be change. For now, the physical extents must be collected at the beginning of the PV. 
*pvdisplay* and *pvs* can be used to verify how many PEs are used and how these are 
mapped on the volume.

```text
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
```

PEs belonging to the same LVs are normally clustered together as shown in the output above.
PEs from 22494 to 22838 (345 PEs) are allocated for tmp and swap. These should be moved right 
after var, starting from PE 473 until 817. This operation can be accomplished with 
*pvmove* command.

```text
[root@localhost tmp]# pvmove --alloc anywhere /dev/sda2:22494:22838 /dev/sda2:473-817
[...]
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
```

There are now 818x32 MiB Physical Extents allocated, which roughly corresponds to 25GB.


```text
[root@localhost tmp]# pvdisplay  | grep Size
  PV Size               744.21 GiB / not usable 24.00 MiB
  PE Size               32.00 MiB
[root@localhost tmp]# echo "scale=2;818\*32/1024" | bc -l
25.56
```

The PV can be resized taking into consideration a safety margin.

```text
[root@localhost tmp]# pvresize --setphysicalvolumesize 30G /dev/sda2
  Physical volume "/dev/sda2" changed
  1 physical volume(s) resized / 0 physical volume(s) not resized
```


Resizing the partition
=======

The partition /dev/sda2 is now larger than the physical volume requires. 
Resizing a partition basically means redefining its boundaries 
in the partition table, i.e. start and end coordinates: this is a critical step, 
which requires much attention. *fdisk* shows the information concerning the current 
layout of the disk.

 
```text
   Device Boot      Start         End      Blocks   Id  System
/dev/sda1   *           1         131     1048576   83  Linux
Partition 1 does not end on cylinder boundary.
/dev/sda2             131       97282   780361728   8e  Linux LVM
```

Pre-GPT partition tables identify the boundaries of partitions both in CHS and 
LBA coordinates. fdisk default displaying unit is cylinders. This comes from the 
DOS era when partitions had to be aligned to cylinder boundaries. As a matter of fact, 
cylinders are identified in the partition table with 10 bits, so a value higher 
than 1024 is just an abstraction implemented by fdisk (also known as  DOS-compatible 
mode).  Nowadays this mode is 
deprecated and logical sectors values are highly recommended. Furthermore, on this 
machine the underlying device is a Solid State Drive, so CHS addressing does not
make any sense at all. And there is more! This is a 4KB pages device so not
even 512 bytes logical block addressing makes sense: it is purely an abstraction 
implemented by the firmware. For the remainder of these notes, I have used cylinder
values. This is really not a good a idea, as the resulting partition is not aligned
with the optimal I/O size of the device, 4KB, which impacts both performance and 
flash wearout, the latter maybe not being that critical anymore in 2016. 
A flawless redefinition of the partition boundaries must take into consideration 
the optimal I/O size.

Anyhow, I will be continuing considering cylinder coordinates.

fdisk reports that a cylinder corresponds to ~7.84MiB. /dev/sda2 must be
deleted and recreated with the same Start cylinder. The End cylinder is obviously 
defined based on the desired size, 35GB in this case or ~4571 cylinders. LVM type 
must also be set with fdisk. The layout is now the following:

```text
[root@localhost tmp]# parted -l
Model: ATA INTEL SSDSC2BB80 (scsi)
Disk /dev/sda: 800GB
Sector size (logical/physical): 512B/4096B
Partition Table: msdos

Number  Start   End     Size    Type     File system  Flags
 1      1049kB  1075MB  1074MB  primary  ext4         boot
 2      1075MB  39.1GB  38.0GB  primary
```

To obtain a compressed image of the disk, the LVs must be first disabled and /dev/sda
dumped for around ~40GB from the beginning of the disk: everything else beyond this
area is unallocated space and therefore not interesting.


```text
vgchange -a n vg1
dd if=/dev/sda conv=sync bs=128K count=328000| gzip -c  > /tmp/sda.img.gzip
```

The live environment must provide enough in-memory space for dumping the whole
compressed file. My configuration led to a 14GB image, and RAM was large enough
to host it. With more careful rounding, 
the compression ratio can be improved significantly. To test the restore procedure, 
the image can be simply decompressed and written on the disk.


```text
[root@localhost tmp]# dd if=/dev/zero of=/dev/sda
29973169+0 records in
29973169+0 records out
15346262528 bytes (15 GB) copied, 25.5131 s, 602 MB/s

[root@localhost tmp]# dd if=<(gunzip -c -d sda.img.gzip) of=/dev/sda conv=sync bs=4M  
[root@localhost tmp]# reboot
```

If everything went well, the system should boot into the exact same environment as before.
