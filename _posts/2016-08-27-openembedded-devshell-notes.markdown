---
layout: post
title:  "Openembedde devshell notes"
date:   2016-08-27 08:00:00
published: no
categories: openembedded
pygments: true
summary: "devshell is a great feature implemented in Openembedded that allows to spawn
a cross-compilation terminal session that replicates the build time environment used
by the tool. It allows to save a lot of time and headaches when packages fail to
compile, even though making it work properly is not always straightforward. 
Here I have collected some examples of issues I have troubleshooted in the past 
via devshell and few examples of hurdles I came across when trying to leverage
this feature."

---

Spawning a development shell
=======
Spawning a development shell is as simple as calling *devshell* task on the desired
package.

```
bitbake -c devshell lighttpd
```

The feature is implemented in *openembedded-core/meta/classes/terminal.bbclass*
and *openembedded-core/meta/classes/devshell.bbclass*. These class files export
functions that build the cross compilation environment by exporting environment
variables that point to the cross-toolchain and tools (e.g. *PATH*, *PKG_CONFIG_DIR*,
*CFLAGS*, *LDFLAGS*, *CC*, etc). Function *emit_terminal_func* in *terminal.bbclass* creates
an initialization script executed by the shell pointed by *DEVSHELL* that sets
all the aforementioned variables. The shell is executed within the terminal emulator
of choice (*OE_TERMINAL*)  by the code in module *openembedded-core/meta/lib/oe/terminal.py*. Supported
terminal emulators are, for instance, xterm, gnome-terminal, tmux, screen, konsole, etc.
To bear in mind that when a new shell is spawn, the relative *rc* script is executed,
e.g. *.zshrc* or *.bashrc*. If this exports variables that are part of the cross-compilation
environment, e.g. *PATH*, then there will necessarily be a conflict and the cross-toolchain
will not be setup correctly.


A first example
=======
Let's consider a real world example: when building *lighttpd*, configure fails
with the following errors:

```
| checking for pcre-config... <OE-ROOT>/build/tmp-glibc/sysroots/raspberrypi/usr/bin/crossscripts/pcre-config
| ERROR: /usr/bin/pcre-config should not be used, use an alternative such as pkg-config
| ERROR: /usr/bin/pcre-config should not be used, use an alternative such as pkg-config
| checking for zlib support... yes
| checking for deflate in -lz... no
| configure: error: zlib-headers and/or libs were not found, install them or build with --without-zlib
```


