---
layout: post
title:  "Linux VFS internals: dentries"
date:   2016-09-19 08:00:00
published: yes
categories: linux
pygments: true
---

There is often a lot of counfusion around how directories are represented on the filesystem. This
post tries to clarify how ext4 uses `dirent` structure to store directory information.

Linux VFS
=======
The Linux VFS subsystem implements file-system realted operations by exporting the
usual open/read/write interface to userspace processes regardless of the underlying
filesystem or physical device. The main objects implemented by the VFS layer are
`superblock`, `inode`, `dentry` and `file`. 


superblock
=======
The `super_block` object is a collection of metadata describing a filesystem.
On ext filesystems, this object reflects the information stored in the 
filesystem superblock at the beginning of each partition, just 
after the initial boot block. The VFS superblock 
contains information such as:

  * The filesystem block size
  * The filesystem magic number
  * An object representing the mount point within the system (see `dentry` discussion
  further down)
  * A pointer to a pool of inodes

The `superblock` is extremely important and it is usually backed up throughout
the whole medium on ext filesystems. `dumpe2fs` lists all the backup copies available.

inode and dentry
=======
The VFS treats directories as special files and represents each component
of a filesystem path with a `dentry` object. Dentries 
are not physically stored on the medium, but they are rather created on-the-fly by
the kernel when needed. The most relevant fields of a `dentry` are the following:

  * `struct dentry *d_parent`, a pointer to the parent `dentry`. When building
  a path, the kernel chains the corresponding dentries together.
  * `struct inode *d_inode`, a pointer to the `inode` implementing the current
  element of the path, being it a directory or a regular file.
  * `struct qstr d_name`, the name of the path element. Names are not part of
  the `inode` but rather of the `dentry`.


Directories structure on the filesystem
=======
As mentioned before, directories are also represented on the filesystem with 
inodes, which in turn contain pointers to blocks on the storage device. The layout of
a directory on the storage device consists of a list of <inode, name> pairs that
represent the entities contained in that directory. Linux uses the `dirent` 
structure to model such information:


{% highlight text  %}
struct dirent {
       ino_t          d_ino;       /* inode number */
       off_t          d_off;       /* not an offset; see NOTES */
       unsigned short d_reclen;    /* length of this record */
       unsigned char  d_type;      /* type of file; not supported
                                      by all filesystem types */
       char           d_name[256]; /* filename */
};
{% endhighlight %}

It is straightforward to verify the layout of a directory directly on the storage 
device. Considering for example the following hierarchy:

{% highlight text  %}
directory1
`|- [13320526]  directory2
 |- [13328753]  directory3
 `- [13238920]  file1
{% endhighlight %}

`debugfs` allows to obtain the block numbers referenced by an inode representing a 
file or a directory. In this case, directory `directory1` has inode number 13279608 
(`ls` with `-i` flag displays such information).

{% highlight text  %}
$ sudo debugfs /dev/mapper/debian-debian--home
debugfs:  stat <13279608>
Inode: 13279608   Type: directory    Mode:  0755   Flags: 0x80000
Generation: 791866861    Version: 0x00000000:0000000c
User:  1000   Group:  1000   Size: 4096
File ACL: 0    Directory ACL: 0
Links: 4   Blockcount: 8
Fragment:  Address: 0    Number: 0    Size: 0
 ctime: 0x583aaaed:81e380d8 -- Sun Nov 27 10:44:13 2016
 atime: 0x583aaaf4:84c24ee8 -- Sun Nov 27 10:44:20 2016
 mtime: 0x583aaaed:81e380d8 -- Sun Nov 27 10:44:13 2016
crtime: 0x57eac34a:8c8b2808 -- Tue Sep 27 21:06:50 2016
Size of extra inode fields: 28
EXTENTS:
(0):52965455
{% endhighlight %}

This directory is stored in block 52965455, whose sector position on the storage device
depends on the filesystem block size.

{% highlight text  %}
$ sudo dumpe2fs /dev/mapper/debian-debian--home  | grep "Block size"
dumpe2fs 1.42.12 (29-Aug-2014)
Block size:               4096
{% endhighlight %}
Extent 52965455 corresponds to sector `52965455*8` when using 4K blocks, i.e. 
423723640, which can be dumped with `dd`. `stat` reports a size of 4K, which is
the allocation unit at the filesystem level, but the relevant data is most 
likely less than 4096 bytes.

{% highlight text  %}
$ sudo dd if=/dev/mapper/debian-debian--home of=dump.bin skip=52965455 bs=4K count=1 
1+0 records in
1+0 records out
4096 bytes (4.1 kB) copied, 0.000197388 s, 20.8 MB/s
{% endhighlight %}
The first part of the hex dump is the following:

{% highlight text  %}
00000000  78 a1 ca 00 0c 00 01 02  2e 00 00 00 01 00 ca 00  |x...............|
00000010  0c 00 02 02 2e 2e 00 00  88 02 ca 00 10 00 05 01  |................|
00000020  66 69 6c 65 31 62 61 64  4e 41 cb 00 14 00 0a 02  |file1badNA......|
00000030  64 69 72 65 63 74 6f 72  79 32 ca 00 71 61 cb 00  |directory2..qa..|
00000040  c4 0f 0a 02 64 69 72 65  63 74 6f 72 79 33 05 07  |....directory3..|
00000050  74 65 6d 70 38 73 74 32  35 36 2e 73 62 73 74 6f  |temp8st256.sbsto|
00000060  72 65 00 00 1e 62 ca 00  24 00 1c 01 67 6f 6f 67  |re...b..$...goog|
00000070  70 75 62 2d 70 68 69 73  68 2d 73 68 61 76 61 72  |pub-phish-shavar|
00000080  2e 73 62 73 74 6f 72 65  25 62 ca 00 24 00 1a 01  |.sbstore%b..$...|
00000090  74 65 73 74 2d 66 6f 72  62 69 64 2d 73 69 6d 70  |test-forbid-simp|
000000a0  6c 65 2e 73 62 73 74 6f  72 65 00 00 29 62 ca 00  |le.sbstore..)b..|
{% endhighlight %}
Indeed this 4K block seems to contain the directory information but
also additional irrelevant data from previous allocations in the same block. The first
piece of information that immediately stands out is the name of the files and directories
contained in `directory1`. What should follow each file name is an `ino_t` representing
the inode number, encoded as a little endian `unsigned long` at the VFS layers,
which translates to 64-bits on my system.
However, it is up to the actual implementation to decide how to map Linux VFS fields
to the internal structures. As an example, `ext4` uses `ext4_dir_entry` which consists
of the following fields:

{% highlight c  %}
struct ext4_dir_entry {
    __le32  inode;                  /* Inode number */
    __le16  rec_len;                /* Directory entry length */
    __le16  name_len;               /* Name length */
    char    name[EXT4_NAME_LEN];    /* File name */
}; 
{% endhighlight %}
The binary dump from 0x18 to 0x30 represents entry `file1` and maps directy to the 
fields above.

{% highlight text  %}
88 02 ca 00         __le32 representing the inode number (13238920)
10 00               __le16 representing the directory entry length (16) 
05 01               __le16 representing the file name length (261)
66 69 6c 65 31      char*  representing the file name
{% endhighlight %}
Does this look right? Not really. `inode` seems correct and `rec_len` as well (the total
record len would be 13, but it's rounded to the byte boundary). `name_len` instead
is definitely not correct: it should be simply 0x05 and the leftmost byte should
be 0x00. This mismatch can be explained with the introduction of `ext4_dir_entry_2`
structure, which is defined in `fs/ext4/ext4.h` as follows:

{% highlight c  %}
/*
* The new version of the directory entry. Since EXT4 structures are
* stored in intel byte order, and the name_len field could never be
* bigger than 255 chars, it's safe to reclaim the extra byte for the
* file_type field.
*/
struct ext4_dir_entry_2 {
    __le32 inode;             /* Inode number */
    __le16 rec_len;           /* Directory entry length */
    __u8 name_len;            /* Name length */
    __u8 file_type;
    char name[EXT4_NAME_LEN]; /* File name */
};
{% endhighlight %}
So, `EXT4_NAME_LEN` is defined as 255, therefore having 2 bytes to represent 
the lenght does not make much sense. As a consequence, one byte that previously
was part of the `__le16` representing the name is now used to designate the file
type and indeed now `name_len` becomes a `__u8`, i.e. simply 0x05. The same analysis
can be applied to the remaining entries. Now, the analysis started from the 
first entry which could be easiy identified from the filename, but the block contains
some more data from 0x00 to 0x17.

{% highlight text  %}
00000000  78 a1 ca 00 0c 00 01 02  2e 00 00 00 01 00 ca 00  |x...............|
00000010  0c 00 02 02 2e 2e 00 00                           |........|
{% endhighlight %}

What is this data? Well `0x78a1ca00` looks like a little endian inode number
and so does `0x0100ca00`. A quick check reveals what these entries are:

{% highlight text  %}
$ sudo debugfs /dev/mapper/debian-debian--home
debugfs 1.42.12 (29-Aug-2014)
debugfs:  ncheck 13238273
Inode   Pathname
13238273    //mguerri
debugfs:  ncheck 13279608
Inode   Pathname
13279608    /mguerri/directory1
{% endhighlight %}

These are `dentries` representing *.* and *..*!
