---
layout: post
title:  "Gentoo full disk encryption with dm-crypt"
date:   2013-10-07 13:31:48
categories: jekyll update
---


This post sums up the installation procedure of a Gentoo Linux distribution with
encrypted root and swap partitions using LUKS and dm\_crypt. Everything will
be done manually (kernel compilation, creation of the initrd): the aim is 
therefore to show what happens under the hood when you click on the encryption checkbox 
in the bottom of a common disk partitioning menu during Linux installation.

{% comment %}
<div align="center">
<a id="single_image" href="/assets/img/gentoo-enc/encrypt.png">
<img src="/assets/img/gentoo-enc/encrypt.thumb.png" alt=""/>
</a>
</div>
{% endcomment %}

The procedure is more or less the same as the
one outlined in the [Gentoo Linux x86 Handbook](#gentoo_handbook). However, when it comes to
paritioning the drive, compiling the Kernel and setting the initial ramdisk,
several different steps must be carried out.

I went through the whole process inside a Virtual Machine, using VMWare Player 
as hypervisor. The Gentoo live image I have used is the weekly build 
[install-x86-minimal-20130820](#sha512).

Working "remotely" through ssh is much more convenient. You need to generate ssh
keys, set a root password and start sshd daemon. The commands below generate
a new set of RSA/DSA keys.

    livecd ~ # ssh-keygen -t rsa -C "gentoo-setup"
    [...]
    Enter file in which to save the key (/root/.ssh/id_rsa): /etc/ssh/ssh_host_rsa_key
    [...]
    livecd ~ # ssh-keygen -t dsa -C "gentoo-setup"
    [...]
    Enter file in which to save the key (/root/.ssh/id_rsa): /etc/ssh/ssh_host_dsa_key
    [...]

The Gentoo Linux x86 Handbook can be followed up to step 4, which deals with hard
disks configuration. I will be using /dev/sda both for boot and root partitions.

First step: creating a plain primary boot partition with fdisk, /dev/sda1, and
formatting it with a Unix-like filesystem, ext4 in this case.
As far as the size is concerned, 256M are enough. To create the fs, mkfs.ext4 is
the tool that we need.

    mkfs.ext4 /dev/sda1

The second partition, which will be used to map two logical encrypted volumes
for root and swap, can take up all the space left on the device. After the
creation of the partitions, /dev/sda2 must be formatted to be a LUKS compliant
partition:
    
    livecd ~ # cryptsetup --verify-passphrase luksFormat /dev/sda2
    [...]
    WARNING!
    ========
    This will overwrite data on /dev/sda2 irrevocably.

    Are you sure? (Type uppercase yes): YES
    Enter LUKS passphrase: 
    Verify passphrase: 

Now we create two logical volumes inside the encrypted partition, one for root
and one for swap. These volumes will be created with the LVM framework. 
First of all the encrypted partition must be opened and a mapping with a plain
device must be set up. This can be setup with the following command. 

    livecd ~ # cryptsetup luksOpen /dev/sda2 vault
    Enter passphrase for /dev/sda2:

The device mapper has created a /dev/mapper/vault device which is
the plain version of the encrypted disk. Now it is time to create two logical
volumes. First step: creating a physical volume.
    
    livecd ~ # pvcreate /dev/mapper/vault           
      Physical volume "/dev/mapper/vault" successfully created

The volume group which will contain the logical volumes must then be created

    livecd ~ # vgcreate vg /dev/mapper/vault
        Volume group "vg" successfully created

Then, the actual volumes can be created. Here I will use a 4GB LV for swap
and a LV for root which will extend up to the end of the physical volume.

    livecd ~ # lvcreate --size 4G --name swap vg
      Logical volume "swap" created
    livecd ~ # lvcreate --extents 100%FREE --name root vg
      Logical volume "root" created

Now under /dev/mapper, the two LV should appear: /dev/mapper/vg-root and 
/dev/mapper/vg-swap. It is time to create filesystems on the LV, for for swap 
and then for root.

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

Now the Gentoo Handbook can be resumed from point 4.f


    livecd ~ # mkdir /mnt/gentoo/
    livecd ~ # mkdir /mnt/gentoo/boot
    livecd ~ # mount /dev/sda1 /mnt/gentoo/boot
    livecd ~ # swapon /dev/mapper/vg-swap 
    livecd ~ # mount /dev/mapper/vg-root /mnt/gentoo/

After the precompiled filesystem has been downloaded and the chrooted environment
has been set, it is time to compile the kernel for the new installation. The 
kernel source code can be retrieved through Portage, Gentoo package manager.

    livecd ~ # emerge gentoo-sources

The version installed with this live image is *linux-3.10.7-gentoo-r1*. 
The configuration procedure is highly hardware dependend. Make sure to activate 
all the necessary modules to support the underlying hardware. For instance, 
a while ago while I was working on a physical machine, I remember having problems 
with the SATA controller which was supported by sata\_nv module, compiled through
the CONFIG\_SATA\_NV configuration option. Now, considering that I am working 
on a virtual machine, the i386\_defconfig lacked these options:

* CONFIG\_FUSION\_SPI for LSI SCSI controller (which is the one emulated by VMPlayer)
* CONFIG\_CRYPTO\_SHA256 to support SHA256 algorithm in kernel space
* CONFIG\_DM\_CRYPT to support dm\_cyrpt framework
* CONFIG\_PCNET32 for network support (this is not strictly necessary to
set up the environtment)

Once the kernel is properly configured, it can be compiled together with the 
modules. 


    make -j4 i386_defconfig
    make modules
    make modules_install

After having compiled the kernel and copied bzImage into /mnt/gentoo/boot, 
Gentoo Handbook can be resumed from Chapter 8. In section 8.a, the fstab file 
is set up. Since we are using logical volumes, the procedure is slightly different 
from the one outlined in the guide. My fstab looks like the following:

    /dev/sda1               /boot       ext4    noauto,noatime  1 2
    /dev/mapper/vg-root     /           ext4    noatime         0 1
    /dev/mapper/vg-swap     none        swap    sw              0 0
    /dev/cdrom              /mnt/cdrom  auto    noauto,ro       0 0
    /dev/fd0                /mnt/floppy auto    noauto          0 0
    /proc                   /proc       proc    default

Chapter 10 of the Gentoo Handbook deals with the installation of the bootloader.
I will use grub legacy (i.e. v1), since I am quite familiar with it and it
will help speed up the process. Inside the chrooted environment proceed as follows.

    export DONT_MOUNT_BOOT=1
    emerge --config =grub-0.97-r12
    * Enter the directory where you want to setup grub: 
    /boot
    * Linking from new grub.conf name to menu.lst
    * Copying files from /lib/grub and /usr/share/grub to /boot/grub
    Probing devices to guess BIOS drives. This may take a long time.
    * Grub has been installed to /boot successfully.

DONT\_MOUNT\_BOOT variable will prevent grub from trying to mount the boot partition
and consequently failing, since it is already mounted. When prompted for the 
installation directory, just type /boot.

It is now time to actually install grub on the MBR of /dev/sda. Open grub
command line simply typing grub and follow the example below.


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

    grub>

An alternative way to install grub is to simply use grub-install as follows.

    grub-install /dev/sda

This will only work as long as df output is not broken. If /etc/mtab is empty, then an error is
raised (df: cannot read table of mounted file systems). A quick workaround is to manually add 
the entry for the boot parition as shown below, which is enough to make grub-install work.

    /dev/sda1 /boot ext4 rw,relatime,data=ordered 0 0"

It is now time to create the initial ramdisk which will be responsible for 
mounting the encrypted device. It will need the basic cryptsetup 
tools and all the relative dependencies listed below.


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


After leaving the chrooted environment, the following script can be used to 
setup the initrd.

    ROOT="/mnt/gentoo"
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

    cp -a /dev/console /dev/sda2 /dev/null /dev/urandom dev

    # Random device to avoid 
    # "Cannot initialize crypt RNG backend" error
    mknod -m 644 dev/random c 1 8

    # Libraries for cryptsetup
    cp -a /lib/ld-linux.so.2 lib
    cp -a /lib/ld-2.15.so lib
    cp -a /usr/lib/libcryptsetup.so.4 lib
    cp -a /usr/lib/libcryptsetup.so.4.2.0 lib
    cp -a /usr/lib/libpopt.so.0 lib
    cp -a /usr/lib/libpopt.so.0.0.0 lib
    cp -a /lib/libc.so.6 lib
    cp -a /lib/libc-2.15.so lib
    cp -a /lib/libuuid.so.1 lib
    cp -a /lib/libuuid.so.1.3.0 lib
    cp -a /lib/libdevmapper.so.1.02 lib
    cp -a /usr/lib/libgcrypt.so.11 lib
    cp -a /usr/lib/libgcrypt.so.11.8.2 lib
    cp -a /lib/libudev.so.1 lib
    cp -a /lib/libudev.so.1.3.5 lib
    cp -a /usr/lib/libgpg-error.so.0 lib
    cp -a /usr/lib/libgpg-error.so.0.8.0 lib
    cp -a /lib/librt.so.1 lib
    cp -a /lib/librt-2.15.so lib
    cp -a /lib/libpthread.so.0 lib
    cp -a /lib/libpthread-2.15.so lib

    # Libraries for vgscan/vgchange
    cp -a /lib/libdl.so.2 lib
    cp -a /lib/libdl-2.15.so lib
    cp -a /lib/libdevmapper-event.so.1.02 lib
    cp -a /lib/libreadline.so.6 lib
    cp -a /lib/libreadline.so.6.2 lib
    cp -a /lib/libncurses.so.5 lib
    cp -a /lib/libncurses.so.5.9 lib

    cat > init << EOF_init
    #!/bin/sh
    echo "Initrd initialization"
    mount -t proc proc /proc
    CMDLINE="`cat /proc/cmdline`"
    mount -t sysfs sysfs /sys
    sleep 3
    /bin/cryptsetup luksOpen /dev/sda2 vault
    /bin/vgchange -ay vg
    mount -r /dev/mapper/vg-root /newroot
    umount /sys
    umount /proc
    exec switch_root /newroot /sbin/init ${CMDLINE}
    EOF_init

    chmod a+x init

The actual initrd image is then built with the following commands.

    cd /mnt/gentoo/boot/initram
    find . | cpio --quiet -o -H newc | gzip -9 > /mnt/gentoo/boot/initramfs

I am not completely sure that cpio is part of the minimal gentoo image. 
It should be in the stage3 image just installed, so it might be necessary to 
specify the absolute path with respect to /mnt/gentoo. Once created the initrd, 
grub.conf must be set to point to the correct binaries. Mine looks like below.

    title Gentoo
    root (hd0,0)
    kernel /bzImage vga=791 (to change the default resolution of /dev/console)
    initrd /initramfs

Everything should be ready now. umount /mnt/gentoo/boot, /mnt/gentoo/proc and 
/mnt/gentoo, reboot and hopefully you will be promped for the password of 
the encrypted volume.
<hr width="30%" style="margin-bottom:20px;margin-top:20px"/>
<ul class="references">
</li> <a name="gentoo_handbook">[1] [Gentoo Linux x86 Handbook](http://www.gentoo.org/doc/en/handbook/handbook-x86.xml?full=1)
</a> </li>
<li> <a name="sha512">[2] sha512: d3135b53770c9a5c8aed760fe5e8525ffd0fd9abc79509bcdca651e33327def2
</a></li>
</ul>
[jekyll-gh]: https://github.com/mojombo/jekyll
[jekyll]:    http://jekyllrb.com

