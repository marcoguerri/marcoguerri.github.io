---
layout: post
title:  "Exploiting Heartbleed bug"
date:   2014-08-23 13:31:48
categories: jekyll update
published: no
pygments: true
---

In this post I will sum up all the steps I have gone though to implement a 
Hearbleed POC. The aim was to try to exploit the well known bug to
steal the private keys from my local instance using a vulnerable version of OpenSSL.
Unfortunately the outcome was not the one I was hoping for, but this has 
proven to be a very interesting experiment anyway.


The bug
=======

Hearbleed, CVE-2014-0160 in the Common Vulnerabilities and Exposures system, 
is a bug which affects OpenSSL library 
and allows an attacker to retrieve a 64KB chunk from the address space of the
process which is using the library. The bug resides in the implementation of one
of the features of the TLS protocol, the TLS Hearbeat Extension, and affects
OpenSSL from version 1.0.1 to 1.0.1f included.

The programming error lies in ssl/t1\_lib.c in function tls1\_process\_heartbeat 
A hearbeat request is a way to check if the remote end of the connection is still
alive. The client sends a request  with a payload and the server is supposed 
to reply with the same payload. This is what happens in the code below.


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

*payload* is the length of the payload of the HB request sent from the client. This
value is read from the request itself. *pl* is a pointer to the buffer containing 
the payload sent by the client. What causes the bug is that
the payload length advertised by the client is never checked against the actual
length of the buffer received. A client might specify a length of N bytes, but
send instead only M bytes, with M < N. When sending back the response,
the server copies *payload* bytes from the buffer pointed by *pl*, which has been
allocated by the server to store the HB request. So in principle a client can
send a HB with an arbitrary length value, and it will get back a chunk of memory
from the server address space. The *payload* field is actually 16 bits long,
so the maximum length is 64KB.


Those 64KB leaked could contain everything which lives in the process address space. 
Of course the worst case scenario is a server leaking a chunk of memory which
contains the private keys used for the SSL connection. Soon after the bug went
public, Cloudflare announced the Heartbleed Challange, asking the community to
steal the private keys from a nginx instance running on their servers. According
to their very early experiments, they thought [this would not happen](#cloudflare_analysis), 
but it turned out they were wrong. In fact, at least four people were able to steal 
the private keys exploiting the heartbleed challenge, Fedor Indutny being the first one.



openssl package
===============

I wanted to try to steal the private keys from my own instance. I am
running Debian Wheezy 7.1 and, according to apt, the openssl version I have
installed on my machine is 1.0.1e.

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

The changelog for openssl_1.0.1e-2+deb7u14 is available 
[here](http://metadata.ftp-master.debian.org/changelogs/main/o/openssl/).
 
On April the 8th, heartbleed bug was fixed and a patch was applied to the package
incrementing the release to deb7u5.

{% highlight console lineos %} 

Salvatore Bonaccorso <carnil@debian.org>  Tue, 08 Apr 2014 10:44:53 +0200

openssl (1.0.1e-2+deb7u5) wheezy-security; urgency=high

  * Non-maintainer upload by the Security Team.
  * Add CVE-2014-0160.patch patch.
    CVE-2014-0160: Fix TLS/DTLS hearbeat information disclosure.
    A missing bounds check in the handling of the TLS heartbeat extension
    can be used to reveal up to 64k of memory to a connected client or
    server.
{% endhighlight %} 

The package installed on the machine is therefore not vulnerable. And it can
be easily verified by sending a malformed HB request. In this case, the server
does not reply.

    ➜  ~ [1] at 15:59:47 [Sun 1] $ ./check_hb
    Initializing new connection...
    Connecting...
    Connected!
    resplen:      0

In order to
restore the bug, it is necessary to rebuild the package avoiding the application of
the patch. When the source deb file is downloaded, the patches are applied automatically.
The easiest way to build a vulnerable package it to apply a reverse patch. The 
following commands can be used:


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
you will be asked for a description of the fix, which will be appended on the 
top of the .patch file. In order to modify the changelog, dch can be used, which is part
of devscripts in Debian.

*dch -i*  opens an editor where a new entry in the changelog can be added. 
The version which appears in the changelog will be the one displayed
by apt. For instance, in my case I incremented my version to 1.0.1e-2+deb7u14.1.
The package can be build with  *dpkg-buildpackage -us -uc*.

Once finished, openssl\_1.0.1e-2+deb7u14.1\_i386.deb and related packages will be
available. Heartbleed vulnerability comes from libssl1.0.0, so the package that should be
installed is libssl1.0.0\_1.0.1e-2+deb7u14.1\_i386.deb.


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


In case you want to revert to the old clean version, apt allows to define a
specific revision on the command line.

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
        ssl_certificate     /home/marco/Desktop/HeartBleed/cacert.pem;
        ssl_certificate_key /home/marco/Desktop/HeartBleed/private_unencrypted.pem;
        location / {
                root   /usr/share/nginx/www;
                index  index.html index.htm;
        }
    }


Heartbeat request
=================
The very first step was to try to send a proper hearbeat request to the nginx
instance.

    0x18                    # Type: Heartbeat
    0x03 0x02               # Protocol: TLS 1.1 (SSL v3.2) 
    0x00 0x17               # Record length, size of the heartbeat message
    0x01                    # HB message type: request
    0x00 0x04               # Payload size
    0xDE 0xAD 0xBE 0xEF     # Payload
    0xAB 0x9A 0xC1 0x97     # 16 bytes random padding
    0xDA 0xC8 0xFC 0x92     # 
    0x9E 0xEE 0xD4 0x3B     #
    0x93 0xDD 0x7D 0xB5     #

It turned out to be a bit more complicated than that. The HB message is sent
to the server and wireshark decodes it properly which means that the message is formatted
correctly as the following picture shows.

<p align="center">
<a id="single_image" href="/img/hb_good_request_detail.png"><img src="/img/hb_good_request_detail.png" alt=""/></a>
</p>

However, no response message whatsoever is returned, the server does not reply.
At the beginning I could not explain that: even though the handshake is not terminated,
 the server should reply anyway with a HB response message. After several unsuccessful 
attempts, I decided to go more in depth by following step by step the execution
on the server side.

<p align="center"> 
<a id="single_image" href="/img/hb_good_request.png"><img src="/img/hb_good_request.png" alt=""/></a>
</p>

In order to quickly check if the local instance is vulnerable



[jekyll-gh]: https://github.com/mojombo/jekyll
[jekyll]:    http://jekyllrb.com









<hr width="30%" style="margin-bottom:20px;margin-top:20px"/>
<ul class="references">
</li> <a name="cloudflare_analysis">[1] [CloudFlare Analysis of HeartBleed](https://blog.cloudflare.com/answering-the-critical-question-can-you-get-private-ssl-keys-using-heartbleed/)
</a> </li>
</ul>

