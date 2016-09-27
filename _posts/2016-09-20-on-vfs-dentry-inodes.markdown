---
layout: post
title:  "Linux VFS internals: files, dentries and inodes"
date:   2016-09-19 08:00:00
published: yes
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
struct ext4_dir_entry_2 {
    __le32  inode;                  /* Inode number */
    __le16  rec_len;                /* Directory entry length */
    __u8    name_len;               /* Name length */
    __u8    file_type;
    char    name[EXT4_NAME_LEN];    /* File name */
};
```

It's easy to verify this structure directly on the storage device. Considering for
example the following hierarchy:

```
temp
├── [13261914]  file1
├── [13279614]  temp2
└── [13279615]  temp3
```

*debugfs* allows to dump the block numbers referenced by an inode representing a 
file or a directory:

```
$ sudo debugfs /dev/mapper/debian-debian--home
Inode: 13279608   Type: directory    Mode:  0755   Flags: 0x80000
Generation: 791866861    Version: 0x00000000:00000004
User:  1000   Group:  1000   Size: 4096
File ACL: 0    Directory ACL: 0
Links: 4   Blockcount: 8
Fragment:  Address: 0    Number: 0    Size: 0
 ctime: 0x57eac352:e44a3a40 -- Tue Sep 27 21:06:58 2016
 atime: 0x57eac361:29624a28 -- Tue Sep 27 21:07:13 2016
 mtime: 0x57eac352:e44a3a40 -- Tue Sep 27 21:06:58 2016
crtime: 0x57eac34a:8c8b2808 -- Tue Sep 27 21:06:50 2016
Size of extra inode fields: 28
EXTENTS:
(0):52965455
```

This directory is stored in block (or extent, in this
case the underlying device is a LVM volume so the term extent is more appropriate
) 52965455. What is stored at that location? Let's first check the filesystem block
size:

```
$ sudo dumpe2fs /dev/mapper/debian-debian--home  | grep "Block size"
dumpe2fs 1.42.12 (29-Aug-2014)
Block size:               4096
```
Now, extent 52965455. in 4K blocks corresponds to sector *52965455\*8*, i.e. 
423723640, which can be dumped with *dd*. *stat* reports a size of 4K, which is the graularity 
at the filesystem level (block), but the relevant data is most likely less than 4096 
bytes.

```
$ sudo dd if=/dev/mapper/debian-debian--home skip=423723640 bs=512 count=4 of=block.bin
4+0 records in
4+0 records out
2048 bytes (2.0 kB) copied, 0.000274285 s, 7.5 MB/s
```
The hex dump is the following:

```
00000000  78 a1 ca 00 0c 00 01 02  2e 00 00 00 01 00 ca 00  |x...............|
00000010  0c 00 02 02 2e 2e 00 00  5a 5c ca 00 10 00 05 01  |........Z\......|
00000020  66 69 6c 65 31 62 61 64  7e a1 ca 00 10 00 05 02  |file1bad~.......|
00000030  74 65 6d 70 32 2e 63 61  7f a1 ca 00 c8 0f 05 02  |temp2.ca........|
00000040  74 65 6d 70 33 6f 7a 73  74 64 2d 74 72 61 63 6b  |temp3ozstd-track|
00000050  2d 64 69 67 65 73 74 32  35 36 2e 73 62 73 74 6f  |-digest256.sbsto|
```

Let's try to understand the content of this block.
