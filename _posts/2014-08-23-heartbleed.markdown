---
layout: post
title:  "Exploiting Heartbleed bug"
date:   2014-08-23 13:31:48
categories: jekyll update
published: no
pygments: true
---

In this post I will sum up all the steps I have gone though to implement a 
Hearbleed POC. The aims was of course to try to exploit the well known bug to
steal the private keys from a process running a vulnerable version of OpenSSL.
Unfortunately the outcome has not been the one I was hoping for, but this has 
proven to be a very interesting experiment anyway.


The bug
=======

As probably everyone knowns, Hearbleed, CVE-2014-0160 in the Common 
Vulnerabilities and Exposures system, is a bug which affects OpenSSL library 
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
sending instead only M bytes, with M < N. When sending back the response,
the server copies *payload* bytes from the buffer pointer by pl, which has been
allocated by the server to store the HB request. So in principle a client can
send a HB with an arbitrary length value, and it will get back a chunk of memory
from the server address space. The *payload* field is actually 16 bits long,
so the maximum length is 64KB.


Those leaked 64KB could contain everything which lives in the process address space. 
Of course the worst case scenario is a server leaking a chunk of memory which
contains the private keys used for the SSL connection. Soon after the bug went
public, Cloudflare announced the Heartbleed Challange, asking the community to
steal the private keys of a nginx instance running on their servers. According
to their very early experiments, they thought this would not happen, but it turned 
out they were wrong. In fact, at least four people were able to steal the private
keys exploiting the heartbleed challenge, Fedor Indutny being the first one.

openssl package
===============

I therefore wanted to try to steal the private keys from my own instance. I am
running Debian Wheezy 7.1 and, according to apt, the openssl version I have
installed on my machine is 1.0.1e.

{% highlight console lineos %}
➜  ~ [1] at 20:47:04 [Sun 12] $ sudo apt-cache policy openssl
openssl:
  Installed: 1.0.1e-2+deb7u12
  Candidate: 1.0.1e-2+deb7u12
  Version table:
 *** 1.0.1e-2+deb7u12 0
        500 http://security.debian.org/ wheezy/updates/main i386 Packages
        100 /var/lib/dpkg/status
     1.0.1e-2+deb7u11 0
        500 http://ftp.ch.debian.org/debian/ wheezy/main i386 Packages
{% endhighlight %}

At a first glance, this might already look vulnerable, but checking the output
of openssl version shows that the package has been compiled a couple of months
after the disclosure of the bug.

{% highlight console lineos %} 
➜  ~ [1] at 20:58:59 [Sun 12] $ openssl version -a
OpenSSL 1.0.1e 11 Feb 2013
built on: Thu May  1 22:48:13 CEST 2014
platform: debian-i386-i686/cmov
options:  bn(64,32) rc4(8x,mmx) des(ptr,risc1,16,long) blowfish(idx) 
[...]
{% endhighlight %}

Apparenty trying to check the changelog of the package from the command line
(apt-get changelog) does not work, as it returns a 404. However, the changelog 
can be retrieved anyway from this [link](http://metadata.ftp-master.debian.org/changelogs/main/o/openssl/openssl_1.0.1e-2+deb7u12_changelog). 
On April the 8th, heartbleed bug was fixed and a patch was applied to the package
incrementing the build to deb7u5.

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

The package installed on the machine is therefore not vulnerable. In order to
restore the bug, it is necessary to rebuild it, avoiding the application of
the patch. When the sources are downloaded, the patches are applied automaticall,
the easiest way to build a vulnerable package it to apply a reverse patch. In
bried the following commands can be used:


{% highlight console lineos %}
sudo apt-get source openssl
cd openssl-1.0.1e/debian/patches/
interdiff CVE-2014-0160.patch /dev/null > hb_reversed.patch
mv hb_reversed.patch ../../
patch -p1 < hb_reversed.patch
{% endhighlight %}

The patch should apply successfully. The changes must be committed with dpkg-source 
--commit (you won't be able to compile the new package until then). This will
create the "official" patch out of the differences in the codebase. When committing,
you will be asked for a description of the fix, which will be appended on the 
top of the patch. In order to modify the changelog, dch can be used. This is part
of devscripts in Debian.

*dch -i* hould open an editor where a new entry in the changelog can be appended to the 
old ones. The version which appears in the changelog will the one displayed
by apt. For instance, in my case I incremented my version to 1.0.1e-2+deb7u13.
The package can be build with  *dpkg-buildpackage -us -uc*.

Once finished, openssl\_1.0.1e-2+deb7u13\_i386.deb can be installed. Checking
that the new revision has been correctly installed should lead to the output below.

 {% highlight console lineos %}
➜  ~ [1] at 13:14:50 [Sun 19] $ sudo dpkg -i openssl_1.0.1e-2+deb7u13_i386.deb
[sudo] password for marco: 
(Reading database ... 197475 files and directories currently installed.)
Preparing to replace openssl 1.0.1e-2+deb7u12 (using openssl_1.0.1e-2+deb7u13_i386.deb) ...
Unpacking replacement openssl ...
Setting up openssl (1.0.1e-2+deb7u13) ...
Processing triggers for man-db ...


➜  ~ [1] at 13:15:17 [Sun 19] $ sudo apt-cache policy openssl
openssl:
  Installed: 1.0.1e-2+deb7u13
  Candidate: 1.0.1e-2+deb7u13
  Version table:
 *** 1.0.1e-2+deb7u13 0
        100 /var/lib/dpkg/status
     1.0.1e-2+deb7u12 0
        500 http://security.debian.org/ wheezy/updates/main i386 Packages
     1.0.1e-2+deb7u11 0
        500 http://ftp.ch.debian.org/debian/ wheezy/main i386 Packages
{% endhighlight %}


In case you want to revert to the old clean version, apt allows to define a
specific revision on the command line.

{% highlight console lineos %} 
➜  ~ [1] at 13:18:57 [Sun 19] $  sudo apt-get install openssl=1.0.1e-2+deb7u12
Reading package lists... Done
Building dependency tree       
Reading state information... Done
The following packages will be DOWNGRADED:
  openssl
0 upgraded, 0 newly installed, 1 downgraded, 0 to remove and 246 not upgraded.
Need to get 0 B/694 kB of archives.
After this operation, 0 B of additional disk space will be used.
Do you want to continue [Y/n]? Y
dpkg: warning: downgrading openssl from 1.0.1e-2+deb7u13 to 1.0.1e-2+deb7u12
(Reading database ... 197475 files and directories currently installed.)
Preparing to replace openssl 1.0.1e-2+deb7u13 (using .../openssl_1.0.1e-2+deb7u12_i386.deb) ...
Unpacking replacement openssl ...
Processing triggers for man-db ...
Setting up openssl (1.0.1e-2+deb7u12) ...
{% endhighlight %}


nginx installation
==================



[jekyll-gh]: https://github.com/mojombo/jekyll
[jekyll]:    http://jekyllrb.com










