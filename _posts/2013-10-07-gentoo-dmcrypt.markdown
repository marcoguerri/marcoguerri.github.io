---
layout: post
title:  "Gentoo full disk encryption with dm-crypt"
date:   2013-10-07 13:31:48
categories: jekyll update
summary: "This post sums up the installation procedure of a Gentoo Linux distribution with
encrypted root and swap partitions using LUKS and dm\_crypt. Everything is
done manually (kernel compilation, creation of the initrd): the aim is 
therefore to show what happens under the hood when you click on the encryption checkbox 
in the bottom of a common disk partitioning menu during Linux installation."
---


{% comment %}
<div align="center">
<a id="single_image" href="/assets/img/gentoo-enc/encrypt.png">
<img src="/assets/img/gentoo-enc/encrypt.thumb.png" alt=""/>
</a>
</div>
{% endcomment %}

Initial setup
=============

The procedure is more or less the same as the
one outlined in the [Gentoo Linux x86 Handbook](#gentoo_handbook). However, when it comes to
paritioning the drive, compiling the Kernel and setting the initial ramdisk,
several different steps must be carried out.

I went through the whole process inside a Virtual Machine, using VMWare Player 
as hypervisor. The Gentoo live image I have used is the weekly build 
[install-x86-minimal-20130820](#sha512). Working "remotely" through ssh is much more convenient. RSA/DSA ssh keys must be generated with ssh-keygen, a root password set and sshd daemon started.

Drives configuration
====================

The Gentoo Linux x86 Handbook can be followed up to step 4, which covers hard
disks configuration. I will be using /dev/sda both for boot and root partitions.
The first step is to create a plain primary boot partition with fdisk, /dev/sda1, and
to format it with a Unix-like filesystem, ext4 in this case.
As far as the size is concerned, 256M are enough. mkfs.ext4 can be used to 
create the filesystem (mkfs.ext4 /dev/sda1). The second partition, which will 
be used as a LVM physical volume with on top two logical volumes for root and swap, 
can take up all the space left on the device.  After the creation of the partitions, 
/dev/sda2 must be formatted as a LUKS partition.
   
{% highlight console %}
livecd ~ # cryptsetup --verify-passphrase luksFormat /dev/sda2
[...]
WARNING!
========
This will overwrite data on /dev/sda2 irrevocably.

Are you sure? (Type uppercase yes): YES
Enter LUKS passphrase: 
Verify passphrase: 
{% endhighlight %}

By opening the LUKS volume, a mapping with a plaintext device via the device mapper layer
is created. This can be done with the following command. 

{% highlight console %}
livecd ~ # cryptsetup luksOpen /dev/sda2 vault
Enter passphrase for /dev/sda2:
{% endhighlight %}

The device mapper creates a /dev/mapper/vault. This becomes the LVM physical volume,
which is then added to the volume group.


{% highlight console %}
livecd ~ # pvcreate /dev/mapper/vault           
  Physical volume "/dev/mapper/vault" successfully created

livecd ~ # vgcreate vg /dev/mapper/vault
    Volume group "vg" successfully created
{% endhighlight %}

Now the logical volumes can be created. Here I use a 4GB LV for swap
and a LV for root which takes take up the remaining capacity of the 
volume group.

{% highlight console %}
livecd ~ # lvcreate --size 4G --name swap vg
  Logical volume "swap" created
livecd ~ # lvcreate --extents 100%FREE --name root vg
  Logical volume "root" created
{% endhighlight %}

The two LVs should appear under /dev/mapper: /dev/mapper/vg-root and 
/dev/mapper/vg-swap. A root and swap filesystems must be created on top of the LVs.


{% highlight console %}
livecd ~ # mkswap /dev/mapper/vg-swap 
Setting up swapspace version 1, size = 4194300 KiB
no label, UUID=8fd4d40a-617b-409d-a5e8-ec6bfe926cc5

livecd ~ # mkfs.ext4 /dev/mapper/vg-root 
[...]
{% endhighlight %}
Now the Gentoo Handbook can be resumed from point 4.f


{% highlight console %}
livecd ~ # mkdir /mnt/gentoo/
livecd ~ # mkdir /mnt/gentoo/boot
livecd ~ # mount /dev/sda1 /mnt/gentoo/boot
livecd ~ # swapon /dev/mapper/vg-swap 
livecd ~ # mount /dev/mapper/vg-root /mnt/gentoo/
{% endhighlight %}

Kernel compilation
==================

After the precompiled filesystem has been downloaded and the chrooted environment
has been set, the kernel must be compiled. The kernel source code can be 
retrieved through Portage, Gentoo package manager, by "emerging" *gentoo-sources*.
The version installed with this live image is *linux-3.10.7-gentoo-r1*, but 
the configuration procedure is highly hardware dependend. Make sure to activate 
all the necessary modules to support the underlying hardware. For instance, 
a while ago while I was working on a physical machine, I remember having problems 
with the SATA controller which was supported by sata\_nv module, compiled through
the *CONFIG\_SATA\_NV* configuration option. Now, considering that I am working 
on a virtual machine, the i386\_defconfig lacked these options:


* CONFIG\_FUSION\_SPI for LSI SCSI controller (which is the one emulated by VMPlayer)
* CONFIG\_CRYPTO\_SHA256 to support SHA256 algorithm in kernel space
* CONFIG\_DM\_CRYPT to support dm\_cyrpt framework
* CONFIG\_PCNET32 for network support (this is not strictly necessary to
set up the environment)

Once the kernel is properly configured, it can be compiled together with the 
modules. 


{% highlight console %}
make -j4 i386_defconfig
make modules
make modules_install
{% endhighlight %}

After having compiled the kernel and copied bzImage into /mnt/gentoo/boot, 
Gentoo Handbook can be resumed from Chapter 8. In section 8.a, the fstab file 
is set up. Since I am using logical volumes, the procedure is slightly different 
from the one outlined in the guide. My fstab looks like the following:


{% highlight console %}
/dev/sda1               /boot       ext4    noauto,noatime  1 2
/dev/mapper/vg-root     /           ext4    noatime         0 1
/dev/mapper/vg-swap     none        swap    sw              0 0
/dev/cdrom              /mnt/cdrom  auto    noauto,ro       0 0
/dev/fd0                /mnt/floppy auto    noauto          0 0
/proc                   /proc       proc    default
{% endhighlight %}

Bootloader installation
=======================

Chapter 10 of the Gentoo Handbook deals with the installation of the bootloader.
I will use grub legacy (i.e. v0.97), since I am quite familiar with it and it
will help speed up the process.


{% highlight console %}
export DONT_MOUNT_BOOT=1
emerge --config =grub-0.97-r12
* Enter the directory where you want to setup grub: 
/boot
* Linking from new grub.conf name to menu.lst
* Copying files from /lib/grub and /usr/share/grub to /boot/grub
Probing devices to guess BIOS drives. This may take a long time.
* Grub has been installed to /boot successfully.

{% endhighlight %}

DONT\_MOUNT\_BOOT variable prevents grub from trying to mount the boot partition,
already mounted, and consequently failing. When prompted for the 
installation directory, just type /boot. grub stage1 and stage1.5 must then be installed
respectively on the MBR and in the DOS compatibility region of /dev/sda.



{% highlight console %}
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
{% endhighlight %}

An alternative way to install grub is to simply use *grub-install* on /dev/sda. 
*update-grub* can then be used to update menu.lst (or grub.cfg) based on the kernels
 available under /boot. update-grub only works as long as df output reports correctly the 
boot partition. If /etc/mtab is empty, an error is raised (df: cannot read table of 
mounted file systems). A quick workaround is to manually add to /etc/mtab the 
following entry for the boot partition:


{% highlight console %}
/dev/sda1 /boot ext4 rw,relatime,data=ordered 0 0"
{% endhighlight %}

Creation of the initrd
======================

The initial ramdisk responsible for mounting the encrypted device must then be
created. This should contain cryptsetup tools and all the relative dependencies
listed by ldd.

{% highlight console %}
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
{% endhighlight %}

After leaving the chrooted environment, the following script can be used to 
setup the initrd.


{% highlight console linenos %}
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

LIBS=$'/lib/ld-linux.so.2 \
       /lib/ld-2.15.so \
       /usr/lib/libcryptsetup.so.4 \
       /usr/lib/libcryptsetup.so.4.2.0 \
       /usr/lib/libpopt.so.0 \
       /usr/lib/libpopt.so.0.0.0 \
       /lib/libc.so.6 \
       /lib/libc-2.15.so \
       /lib/libuuid.so.1 \
       /lib/libuuid.so.1.3.0 \
       /lib/libdevmapper.so.1.02 \
       /usr/lib/libgcrypt.so.11  \
       /usr/lib/libgcrypt.so.11.8.2 \
       /lib/libudev.so.1 \
       /lib/libudev.so.1.3.5 \
       /usr/lib/libgpg-error.so.0 \
       /usr/lib/libgpg-error.so.0.8.0 \
       /lib/librt.so.1 \
       /lib/librt-2.15.so \
       /lib/librt-2.15.so \
       /lib/libpthread.so.0 \
       /lib/libpthread-2.15.so'

for l in $LIBS;
do
    cp -a $l lib
done

# Libraries for vgscan/vgchange
LIBS=$'/lib/libdl.so.2 \
       /lib/libdl-2.15.so \
       /lib/libdevmapper-event.so.1.02 \
       /lib/libreadline.so.6 \
       /lib/libreadline.so.6.2 \
       /lib/libncurses.so.5 \
       /lib/libncurses.so.5.9'

for l in $LIBS;
do
    cp -a $l lib
done

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
{% endhighlight %}
The actual initrd image is then built with the following commands.

{% highlight console %}
cd /mnt/gentoo/boot/initram
find . | cpio --quiet -o -H newc | gzip -9 > /mnt/gentoo/boot/initramfs
{% endhighlight %}
I am not completely sure that cpio is part of the minimal gentoo image. 
It should be in the Gentoo stage3 image just installed, so it might be necessary to 
specify the absolute path with respect to /mnt/gentoo. 


Final steps
===========
Once created the initrd, 
grub.conf should be configured to load the kernel image and the initrd. 


{% highlight console %}
title Gentoo
root (hd0,0)
kernel /bzImage vga=791
initrd /initramfs
{% endhighlight %}

After umounting /mnt/gentoo/boot, /mnt/gentoo/proc,
/mnt/gentoo and rebooting the machine, the initrd should ask for the password of 
the encrypted volume and then mount the root filesystem.
<hr width="30%" style="margin-bottom:20px;margin-top:20px"/>
<ul class="references">
<li>
    <a name="gentoo_handbook">[1] <a target="_blank" href="http://www.gentoo.org/doc/en/handbook/handbook-x86.xml?full=1">Gentoo Linux x86 Handbook</a>
   </a> 
</li>
<li> 
    <a name="sha512">[2] sha512: d3135b53770c9a5c8aed760fe5e8525ffd0fd9abc79509bcdca651e33327def2 </a>
</li>
</ul>
[jekyll-gh]: https://github.com/mojombo/jekyll
[jekyll]:    http://jekyllrb.com

