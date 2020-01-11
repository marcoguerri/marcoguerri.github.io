---
layout: post
title:  "Gentoo full disk encryption with dm-crypt/LUKS"
date:   2013-10-07 13:31:48
categories: linux security
---


{% comment %}
<div align="center">
<a id="single_image" href="/img/gentoo-encryption/encrypt.png">
<img src="/img/gentoo-encryption/encrypt.thumb.png" alt=""/>
</a>
</div>
{% endcomment %}

Introduction
=============
This post covers the installation procedure of Gentoo Linux with
encrypted root and swap partitions using LUKS and dm\_crypt. Each step is carried out
manually (kernel compilation, creation of the initrd): the aim is to give an insight
into what happens under the hood when encryption is enabled at disk partitioning time
during the installation of a Linux distro.

Initial setup
=============

The procedure is more or less the same as the
one outlined in the [Gentoo Linux x86 Handbook](http://www.gentoo.org/doc/en/handbook/handbook-x86.xml?full=1). 
However, when it comes to
paritioning the drive, compiling the Kernel and setting the initial ramdisk,
several different steps must be carried out.

I went through the whole process inside a Virtual Machine, using VMWare Player 
as hypervisor. The Gentoo live image I used is the weekly build 
`install-x86-minimal-20130820` (sha512: d3135b53). Working "remotely" through ssh is much 
more convenient. RSA/DSA ssh keys must be generated with ssh-keygen, a root password 
set and sshd daemon started.

Drives configuration
====================

The Gentoo Linux x86 Handbook can be followed up to step 4, which covers hard
disks configuration. I will be using /dev/sda both for boot and root partitions.
The first step is to create a plain primary boot partition with fdisk and
to format it with a Unix-like filesystem, ext4 in this case, with mkfs.ext4.
As far as the size is concerned, 256M are enough. The second partition, which will 
be used as a LVM physical volume with on top two logical volumes for root and swap, 
can take up all the space left on the device.  This second partition must be 
formatted as a LUKS partition.
   
```text
livecd ~ # cryptsetup --verify-passphrase luksFormat /dev/sda2
[...]
WARNING!
========
This will overwrite data on /dev/sda2 irrevocably.

Are you sure? (Type uppercase yes): YES
Enter LUKS passphrase: 
Verify passphrase: 
```
By opening the LUKS volume, a mapping with a plaintext device via the device mapper layer
is created. This can be done with the following command. 

```text
livecd ~ # cryptsetup luksOpen /dev/sda2 vault
Enter passphrase for /dev/sda2:
```

The device mapper creates a /dev/mapper/vault. This becomes the LVM physical volume,
which is then added to the volume group.


```text
livecd ~ # pvcreate /dev/mapper/vault           
  Physical volume "/dev/mapper/vault" successfully created

livecd ~ # vgcreate vg /dev/mapper/vault
    Volume group "vg" successfully created
```

Now the logical volumes can be created. I used a 4GB LV for swap
and a LV for root which takes take up the remaining capacity of the 
volume group.

```text
livecd ~ # lvcreate --size 4G --name swap vg
  Logical volume "swap" created
livecd ~ # lvcreate --extents 100%FREE --name root vg
  Logical volume "root" created
```

The two LVs should appear under /dev/mapper: /dev/mapper/vg-root and 
/dev/mapper/vg-swap. A root and swap filesystems must be created on top of the LVs.


```text
livecd ~ # mkswap /dev/mapper/vg-swap 
Setting up swapspace version 1, size = 4194300 KiB
no label, UUID=8fd4d40a-617b-409d-a5e8-ec6bfe926cc5

livecd ~ # mkfs.ext4 /dev/mapper/vg-root 
[...]
```
Now the Gentoo Handbook can be resumed from point 4.f


```text
livecd ~ # mkdir /mnt/gentoo/
livecd ~ # mkdir /mnt/gentoo/boot
livecd ~ # mount /dev/sda1 /mnt/gentoo/boot
livecd ~ # swapon /dev/mapper/vg-swap 
livecd ~ # mount /dev/mapper/vg-root /mnt/gentoo/
```

Kernel compilation
==================

After the precompiled filesystem has been downloaded and the chrooted environment
has been set, the kernel must be compiled. The kernel source code can be 
retrieved through Portage, Gentoo package manager, by "emerging" `gentoo-sources`.
The version installed with this live image is `linux-3.10.7-gentoo-r1`, but 
the configuration procedure is highly hardware dependend. Make sure to activate 
all the necessary modules to support the underlying hardware. For instance, 
a while ago while I was working on a physical machine, I remember having problems 
with the SATA controller which was supported by sata\_nv module, compiled through
the `CONFIG_SATA_NV` configuration option. Now, considering that I am working 
on a virtual machine, the `i386_defconfig` lacked these options:


* `CONFIG_FUSION_SPI` for LSI SCSI controller (which is the one emulated by VMPlayer)
* `CONFIG_CRYPTO_SHA256` to support SHA256 algorithm in kernel space
* `CONFIG_DM_CRYPT` to support dm_cyrpt framework
* `CONFIG_PCNET32` for network support (this is not strictly necessary to
set up the environment)

Once the kernel is properly configured, it can be compiled together with the 
modules. 


```text
make -j4 i386_defconfig
make modules
make modules_install
```

After having compiled the kernel and copied the bzImage into /mnt/gentoo/boot, 
Gentoo Handbook can be resumed from Chapter 8. In section 8.a, the fstab file 
is set up. Since I am using logical volumes, the procedure is slightly different 
from the one outlined in the guide. My fstab looks like the following:


```text
/dev/sda1               /boot       ext4    noauto,noatime  1 2
/dev/mapper/vg-root     /           ext4    noatime         0 1
/dev/mapper/vg-swap     none        swap    sw              0 0
/dev/cdrom              /mnt/cdrom  auto    noauto,ro       0 0
/dev/fd0                /mnt/floppy auto    noauto          0 0
/proc                   /proc       proc    default
```

Bootloader installation
=======================

Chapter 10 of the Gentoo Handbook covers the installation of the bootloader.
I will use grub legacy (i.e. v0.97), since I am quite familiar with it and it
will help speed up the process.


```text
export DONT_MOUNT_BOOT=1
emerge --config =grub-0.97-r12
* Enter the directory where you want to setup grub: 
/boot
* Linking from new grub.conf name to menu.lst
* Copying files from /lib/grub and /usr/share/grub to /boot/grub
Probing devices to guess BIOS drives. This may take a long time.
* Grub has been installed to /boot successfully.
```

`DONT_MOUNT_BOOT` variable prevents grub from trying to mount the boot partition,
already mounted, and consequently failing. When prompted for the 
installation directory, just type /boot. grub stage1 and stage1.5 must then be installed
respectively on the MBR and in the DOS compatibility region of /dev/sda.



```text
grub> root (hd0,0)
    Filesystem type is ext2fs, partition type 0x83

grub> setup (hd0)
    Checking if "/boot/grub/stage1" exists... yes
    Checking if "/boot/grub/stage2" exists... yes
    Checking if "/boot/grub/e2fs_stage1_5" exists... yes
    Running "embed /boot/grub/e2fs_stage1_5 (hd0)"...  22 sectors are embedded.
succeeded
    Running "install /boot/grub/stage1 (hd0) (hd0)1+22 p (hd0,0)/boot/grub/stage2 
/boot/grub/menu.lst" succeeded
Done.
```

An alternative way to install grub is to simply use `grub-install` on /dev/sda. 
`update-grub` can normally be used to update menu.lst (or grub.cfg) based on the kernels
 available under /boot, but in this case the configuration file is so simple that
 it can be populated manually. As a aside note, update-grub relies on the output 
 of df command, which must report correctly an entry for the boot partition. If /etc/mtab is empty, 
 an error is raised (df: cannot read table of mounted file systems). A quick workaround 
 is to manually add to /etc/mtab the following line


```text
/dev/sda1 /boot ext4 rw,relatime,data=ordered 0 0"
```

Creation of the initrd
======================

The initial ramdisk responsible for mounting the encrypted device must contain 
cryptsetup tools and all the dependencies listed by ldd.

```text
livecd boot # ldd /sbin/cryptsetup 
  linux-gate.so.1 (0xb7777000)
  libcryptsetup.so.4 => /usr/lib/libcryptsetup.so.4 (0xb7750000)
  libpopt.so.0 => /usr/lib/libpopt.so.0 (0xb7742000)
  libc.so.6 => /lib/libc.so.6 (0xb75c2000)
  libuuid.so.1 => /lib/libuuid.so.1 (0xb75bc000)
  libdevmapper.so.1.02 => /lib/libdevmapper.so.1.02 (0xb7579000)
  libgcrypt.so.11 => /usr/lib/libgcrypt.so.11 (0xb74e8000)
  /lib/ld-linux.so.2 (0xb7778000)
  libudev.so.1 => /lib/libudev.so.1 (0xb74d4000)
  libgpg-error.so.0 => /usr/lib/libgpg-error.so.0 (0xb74cf000)
  librt.so.1 => /lib/librt.so.1 (0xb74c5000)
  libpthread.so.0 => /lib/libpthread.so.0 (0xb74a9000)
```

After leaving the chrooted environment, the following script can be used to 
setup the initrd.

```text
#!/bin/bash
set -x
mkdir -p $ROOT/boot/initram
cd $ROOT/boot/initram
mkdir bin lib dev dev/mapper dev/vc etc newroot proc sys

cp /bin/busybox /sbin/cryptsetup /sbin/mdadm bin
ln -s /bin/busybox bin/cat
ln -s /bin/busybox bin/mount
ln -s /bin/busybox bin/sh
ln -s /bin/busybox bin/switch_root
ln -s /bin/busybox bin/umount
ln -s /bin/busybox bin/sleep

cp -a /sbin/vgchange bin
cp -a /sbin/vgscan bin
cp -a /sbin/lvm bin

cp -a /dev/console /dev/nvme0n1p1 /dev/null /dev/urandom dev

# Random device to avoid 
# "Cannot initialize crypt RNG backend" error
mknod -m 644 dev/random c 1 8

# Libraries for cryptsetup

libs=(
    /lib/ld-linux.so.2
    /lib/ld-2.15.so
    /usr/lib/libcryptsetup.so.4
    /usr/lib/libcryptsetup.so.4.2.0
    /usr/lib/libpopt.so.0
    /usr/lib/libpopt.so.0.0.0
    /lib/libc.so.6
    /lib/libc-2.15.so
    /lib/libuuid.so.1
    /lib/libuuid.so.1.3.0
    /lib/libdevmapper.so.1.02
    /usr/lib/libgcrypt.so.11
    /usr/lib/libgcrypt.so.11.8.2
    /lib/libudev.so.1
    /lib/libudev.so.1.3.5
    /usr/lib/libgpg-error.so.0
    /usr/lib/libgpg-error.so.0.8.0
    /lib/librt.so.1
    /lib/librt-2.15.so
    /lib/librt-2.15.so
    /lib/libpthread.so.0
    /lib/libpthread-2.15.so
)

for l in ${libs[@]};
do
    cp -a $l lib
done

# Libraries for vgscan/vgchange
libs=(
    /lib/libdl.so.2
    /lib/libdl-2.15.so
    /lib/libdevmapper-event.so.1.02
    /lib/libreadline.so.6
    /lib/libreadline.so.6.2
    /lib/libncurses.so.5
    /lib/libncurses.so.5.9
)
for l in ${libs[@]};
do
    cp -a $l lib
done

cat > init << EOF_init
#!/bin/sh
echo "Initrd initialization"
mount -t proc proc /proc
CMDLINE="\$(cat /proc/cmdline)"
mount -t sysfs sysfs /sys
sleep 5 && /bin/cryptsetup luksOpen /dev/sda2 vault
/bin/vgchange -ay vg
mount -r /dev/mapper/vg-root /newroot
umount /sys && umount /proc
exec switch_root /newroot /sbin/init ${CMDLINE}
EOF_init

chmod a+x init
```
The actual initrd image is then built with the following commands (cpio might
need to be invoked with the full path of the stage3 binary).

```text
cd /mnt/gentoo/boot/initram
find . | cpio --quiet -o -H newc | gzip -9 > /mnt/gentoo/boot/initramfs
```


Final steps
===========
Once created the initrd, grub.conf should be configured to load the kernel image 
and the initrd. 


```text
title Gentoo
root (hd0,0)
kernel /bzImage vga=791
initrd /initramfs
```

After umounting /mnt/gentoo/boot, /mnt/gentoo/proc,
/mnt/gentoo and rebooting the machine, the initrd should prompt for the password of 
the encrypted volume and then mount the root filesystem.
