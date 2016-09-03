---
layout: post
title:  "Openembedde devshell notes"
date:   2016-08-27 08:00:00
published: yes
categories: openembedded
pygments: true
summary: "devshell is a great feature implemented in Openembedded that allows to spawn
a cross-compilation terminal session that replicates the build time environment used
by bitbake. It allows to save a lot of time and headaches when packages fail to
compile, even though it is not always straightforward to use.
Here I have collected some examples of issues I have troubleshooted in the past
via devshell and few examples of hurdles I came across when trying to make the most
of this feature."

---

Spawning a development shell
=======
Spawning a development shell is as simple as calling *devshell* task on the desired
package.

```
bitbake -c devshell lighttpd
```

The feature is implemented in *openembedded-core/meta/classes/terminal.bbclass*
and *openembedded-core/meta/classes/devshell.bbclass*. These class files define
functions that build the cross compilation environment by exporting environment
variables that point to the cross-toolchain and tools (e.g. *PATH*, *PKG_CONFIG_DIR*,
*CFLAGS*, *LDFLAGS*, *CC*, etc). Function *emit_terminal_func* in *terminal.bbclass* creates
an initialization script executed by the shell pointed by *DEVSHELL* that sets
all the aforementioned variables. The shell is executed within the terminal emulator
of choice (*OE_TERMINAL* or the one currently being used, i.e. if you are using tmux,
another tmux pane will pop up)  by the code in module  *openembedded-core/meta/lib/oe/terminal.py*.
Supported terminal emulators are, for instance, xterm, gnome-terminal, tmux, screen, konsole, etc.
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

*devshell* opens the cross-compilation environment and, not surprisingly after all,
*./configure* breaks straight away with the following error:

```
checking whether we are cross compiling... configure: error: in `<OE-ROOT>/openembedded-core/build/tmp-glibc/work/arm1176jzfshf-vfp-oe-linux-gnueabi/lighttpd/1.4.41-r0/lighttpd-1.4.41':
configure: error: cannot run C compiled programs.
If you meant to cross compile, use `--host'.
```

Indeed, there is more than simply environment variables.
The GNU conding standard defines at least *--host* and *--build*
configure flags when building for another architecture. In case a cross-compiler
is being built, then *--target* is also necessary. As a matter of fact, *autotools.bbclass*
invokes *./configure* with a the following set of arguments:

```
ONFIGUREOPTS = " --build=${BUILD_SYS} \
          --host=${HOST_SYS} \
          --target=${TARGET_SYS} \
          --prefix=${prefix} \
          --exec_prefix=${exec_prefix} \
          --bindir=${bindir} \
          --sbindir=${sbindir} \
          --libexecdir=${libexecdir} \
          --datadir=${datadir} \
          --sysconfdir=${sysconfdir} \
          --sharedstatedir=${sharedstatedir} \
          --localstatedir=${localstatedir} \
          --libdir=${libdir} \
          --includedir=${includedir} \
          --oldincludedir=${oldincludedir} \
          --infodir=${infodir} \
          --mandir=${mandir} \
          --disable-silent-rules \
          ${CONFIGUREOPT_DEPTRACK} \
          ${@append_libtool_sysroot(d)}"
```

The only relevant variables at compile time are *build*, *host*, *includedir* and
*--with-libtool-sysroot*. The former might not be essential in most of the cases,
unless shared libraries are being compiled. The toolchain *sysroot* is already defined
as part of *$CC* environment variable, therefore all paths specified at compile
time will be considered as relative to that *sysroot*.


```
./configure --build=x86_64-linux --host=arm-oe-linux-gnueabi --includedir=/usr/include --with-libtool-sysroot=<OE-ROOT>/openembedded-core/build/tmp-glibc/sysroots/raspberrypi
[...]
ERROR: /usr/bin/pcre-config should not be used, use an alternative such as pkg-config
ERROR: /usr/bin/pcre-config should not be used, use an alternative such as pkg-config
checking for zlib support... yes
checking for deflate in -lz... no
configure: error: zlib-headers and/or libs were not found, install them or build with --without-zlib
```
A quick look at *config.log* confirms that the test program which is being used
to assess deflate support fails with a *pcre-config* related error:

```
arm-oe-linux-gnueabi-gcc: error: unrecognized command line option '--should-not-have-used-/usr/bin/pcre-config
```

Indeed, *pcre-config*, which is supposed to return the the configuration of the installed
Perl Compatible Regular Expressions library, spits out that funny flag that would
make any tool break. The recommendation is to use *pkg-config* instead. Compiling
the package with *--without-pcre* would be a shame, and the piece of information
that the configure script is missing is only the include and lib path for libpcre:

```
if test "$WITH_PCRE" != "yes"; then
    PCRE_LIB="-L$WITH_PCRE/lib -lpcre"
    CPPFLAGS="$CPPFLAGS -I$WITH_PCRE/include"
else
[...]
```

So, let's try again, this time setting *--with-pcre*. Note that any path specified 
on the command line must point to the cross-compiled libraries and headers. In order
to do this, an additional *=* must be prepended so that the path is considered
relative to the *sysroot*. Not doing so will not break the configure run, but a warning
will appear in configure.log and *do_qa_configure* will detect it and raise
an error.


```
./configure --build=x86_64-linux --host=arm-oe-linux-gnueabi --with-libtool-sysroot=/home/mguerri/nas/Data/Technical/development/rpi/openembedded-core/build/tmp-glibc/sysroots/raspberrypi --includedir=/usr/include --with-pcre==/usr
```

Great, it works, Makefile is created! The flag can be added to the Openembdded recipe via *EXTRA_OECONF*.







