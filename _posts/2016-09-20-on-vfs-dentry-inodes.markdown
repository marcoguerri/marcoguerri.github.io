---
layout: post
title:  "Linux VFS internals: files, dentries and inodes"
date:   2016-09-19 08:00:00
published: no
categories: linux
pygments: true
summary: "A collection of some notes on Linux Virtual Filesystem layer,
focusing mostly on ext filesystems when discussing internal mechanisms that 
go  beyond the implementation independent interface exposed by Linux."
---

Linux VFS
=======
The Linux VFS subsystem implements file-system realted operations by exporting the
usual open/read/write interface to userspace processes regardless of the underlying
filesystem or physical device. The main objects implemented by the VFS layer are
*superblock*, *inode*, *dentry* and *file*. 


superblock
=======
The *super_block* object is a collection of metadata describing a filesystem.
On ext filesystems, this object reflects the information stored in the 
filesystem superblock at the beginning of each partition, just 
after the initial boot block. The VFS superblock 
contains information such as:

  * The filesystem block size
  * The filesystem magic number
  * An object representing the mount point within the system (see *dentry* discussion
  further down)
  * A pointer to a pool of inodes

The *superblock* is extremely important and it is usually backed up throughout
the whole medium on ext filesystems. *dumpe2fs* lists all the backup copies available.

inode and dentry
=======
The VFS treats directories as special files and represents each component
of a filesystem path with a *dentry* object. Dentries 
are not physically stored on the medium, but they are rather created on-the-fly by
the kernel when needed. The most relevant fields of a *dentry* are the following:

  * *struct dentry \*d_parent*, a pointer to the parent *dentry*. When building
  a path, the kernel chains the corresponding dentries together.
  * *struct inode \*d_inode\**, a pointer to the *inode* implementing the current
  element of the path, being it a directory or a regular file.
  * *struct qstr d_name*, the name of the path element. Names are not part of
  the *inode* but rather of the *dentry*.




Directories structure on the filesystem
=======
As mentioned before, directories are also represented on the filesystem with 
inodes, which in turn contain pointers to blocks on the storage device. The layout of
a directory on the filesystems consists in a list of (inode, name) pairs that
represent the entities contained in that directory. As an example, the structure
that implements an item of this list on ext4 filesystems is the following:

```
struct ext4_dir_entry {
    __le32  inode;                  /* Inode number */
    __le16  rec_len;                /* Directory entry length */
    __le16  name_len;               /* Name length */
    char    name[EXT4_NAME_LEN];    /* File name */
};
```
It's easy to verify this structure directly on the filesystem. Considering for
example the following hierarchy:
```
temp
├── [3246175]  file1
├── [3243655]  temp2/
└── [3246185]  temp3/
```
*debugfs* allows to dump the block number from the inode representing a file
or a directory:

```
mguerri-dell ~ at 7:51:13 [Tue 27] $ sudo debugfs /dev/mapper/fedora-home
debugfs 1.42.13 (17-May-2015)
debugfs:  stat mguerri/temp
Inode: 8511955   Type: directory    Mode:  0755   Flags: 0x80000
Generation: 1514059235    Version: 0x00000000:00000004
User: 50060   Group:  2763   Size: 4096
File ACL: 0    Directory ACL: 0
Links: 4   Blockcount: 8
Fragment:  Address: 0    Number: 0    Size: 0
 ctime: 0x57ea08b9:e09a2c80 -- Tue Sep 27 07:50:49 2016
 atime: 0x57ea079f:530aeba8 -- Tue Sep 27 07:46:07 2016
 mtime: 0x57ea05b8:b8d4dfbc -- Tue Sep 27 07:38:00 2016
crtime: 0x57ea08b9:e05d2314 -- Tue Sep 27 07:50:49 2016
Size of extra inode fields: 32
EXTENTS:
(0):33566588
```

`debugfs` reports that this directory is stored in block (or extent, in this
case the underlying device is a LVM volume so the term extent is more appropriate
) 33566588. What is stored at that location? Let's first check the filesystem block
size:

```
mguerri-dell ~ at 7:59:42 [Tue 27] $ sudo dumpe2fs /dev/mapper/fedora-root | grep -i "Block size"    
dumpe2fs 1.42.13 (17-May-2015)
Block size:               4096
```
Now, extent 33566588 in 4K blocks corresponds to sector `33566588*8`, i.e. 268532704,
which can be dumped with `dd`. `stat` reports a size of 4K, which is the graularity 
at the filesystem level (block), but the relevant data is most likely less than 4096 
bytes.

```
mguerri-dell ~ at 8:02:23 [Tue 27] $ sudo dd if=/dev/mapper/fedora-home skip=268532704 bs=512 count=8 of=layout.bin
8+0 records in
8+0 records out
4096 bytes (4.1 kB) copied, 0.00012592 s, 32.5 MB/s
```


```
00000000  d3 e1 81 00 0c 00 01 02  2e 00 00 00 01 00 80 00  |................|
00000010  0c 00 02 02 2e 2e 00 00  d3 e1 83 00 10 00 05 02  |................|
00000020  74 65 6d 70 32 66 6f 72  81 9a 80 00 10 00 05 01  |temp2for........|
00000030  66 69 6c 65 31 65 74 38  d0 01 85 00 c8 0f 05 02  |file1et8........|
00000040  74 65 6d 70 33 74 72 61  63 6b 77 68 69 74 65 2d  |temp3trackwhite-|
00000050  73 69 6d 70 6c 65 2e 63  61 63 68 65 52 e8 80 00  |simple.cacheR...|
00000060  2c 00 23 01 6d 6f 7a 73  74 64 2d 74 72 61 63 6b  |,.#.mozstd-track|
```
