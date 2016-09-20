---
layout: post
title:  "Linux VFS internals: files, dentries and inodes"
date:   2016-09-19 08:00:00
published: no
categories: linux
pygments: true
summary: "A collection of some notes on Linux Virtual Filesystem layer,
focusing mostly on ext filesystems when discussing system internals beyond
the filesystem agnostic interface."
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
of a filesystem path with a *dentry* object, including files. Dentries 
are not physically stored on the medium, but they are rather created on-the-fly by
the kernel when needed. The most relevant fields of a *dentry* are the following:

  * *struct dentry \*d_parent*, a pointer to the parent *dentry*. When building
  a path, the kernel chains the corresponding dentries together.
  * *struct inode \*d_inode\**, a pointer to the *inode* implementing the current
  element of the path, being it a directory or a regular file.
  * *struct qstr d_name*, the name of the path element. Names are not part of
  the *inode* but rather of the *dentry*.



