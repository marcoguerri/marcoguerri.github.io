---
layout: post
title:  "CAP_NET_ADMIN and Linux capabilities meet Docker"
date:   2023-10-13 08:00:00
published: false
pygments: true
toc: true
tags: [docker, linux, capabilities]
categories: [Technical]
---

I spent more time than I was willing to trying to get usage of capabilities right in Docker. I either stumbled
across documentation that was too shallow to be of any use
beyond extremely basic use cases or documentation that was outdated and misleading. 
One possible complaint I would feel like addressing to Docker ecosystem is that is tries
to be excessively easy for the end user, hiding any possible source of complexity. Sometime you do need to
implement slighly more complex setups, and you are on your own, with the codebase being the last resort to get
unblocked.
In my case, I did have to to look into Moby's codebase
to understand how capabilities were managed. This post is an attempt to summarize what I essentially wished
I'd known before diving into capabilities support for Docker.

Docker documentation on capabilities
=======
Start from [docs.docker.com](https://docs.docker.com/engine/reference/run/#runtime-privilege-and-linux-capabilities), one is pointed to `--cap-add` and `--cap-drop` to
implement fined grain control over which capabilities are given to the container:

> In addition to --privileged, the operator can have fine grain control over the capabilities using --cap-add and --cap-drop. By default, Docker has a default list of capabilities that are kept. The following table lists the Linux capability options which are allowed by default and can be dropped.

By itself, I find this already very confusing. There are multiple set of capabilities assigned to a process, i.e.
`permitted`, `effective`, `inheritable`. These are not mentioned anywhere. Reading further:

> To mount a FUSE based filesystem, you need to combine both --cap-add and --device:

To me, this is an example of what I briefly mentioned in the summary: an excessive attempt to hide complexity 
from users. 
Mounting a FUSE filesystem
is something that certainly many users need to do at some point. But I'd rather understand the foundamental
concepts around capabilities implementation in Docker, than consume a series of baked recipes for very
specific use cases.

This is essentially it. From the docker/labs repo, there seems to be [additional documentation on capabilities](https://github.com/docker/labs/blob/master/security/capabilities/README.md). This seems to be outdated, and
it's useful to rebuild the history of capabilities management in Docker to see how we got into this state.


root vs non-root containers
=======

One of the use cases I was working with required adding network interfaces inside the container network namespace. In particular, I needed to add a bridge:

```
$ sudo docker run -it debian ip link add name br0 type bridge
RTNETLINK answers: Operation not permitted
```

The failure was expected. The container is running as root and by default docker daemon drops all capabilities, except a default set. The documentation is clear about this and it can be easily verified:
```
$ sudo docker run -it debian capsh --print
Current: = cap_chown,cap_dac_override,cap_fowner,cap_fsetid,cap_kill,cap_setgid,cap_setuid,cap_setpcap,cap_net_bind_service,cap_net_raw,cap_sys_chroot,cap_mknod,cap_audit_write,cap_setfcap+ep
Bounding set =cap_chown,cap_dac_override,cap_fowner,cap_fsetid,cap_kill,cap_setgid,cap_setuid,cap_setpcap,cap_net_bind_service,cap_net_raw,cap_sys_chroot,cap_mknod,cap_audit_write,cap_setfcap
Securebits: 00/0x0/1'b0
 secure-noroot: no (unlocked)
 secure-no-suid-fixup: no (unlocked)
 secure-keep-caps: no (unlocked)
uid=0(root)
gid=0(root)
groups=0(root)
```
As `CAP_NET_ADMIN` is necessary to manipulate network interfaces, the failure was expected. Adding
that specific capability seems to be sufficient for the command to succeed:
```
$ sudo docker run --cap-add CAP_NET_ADMIN -it debian ip link add name br0 type bridge  
$
```
We can double check that the capability is added to the "current" (i.e. effective) set:
```
$ sudo docker run --cap-add CAP_NET_ADMIN -it debian capsh --print
Current: = cap_chown,cap_dac_override,cap_fowner,cap_fsetid,cap_kill,cap_setgid,cap_setuid,cap_setpcap,cap_net_bind_service,cap_net_admin,cap_net_raw,cap_sys_chroot,cap_mknod,cap_audit_write,cap_setfcap+ep
Bounding set =cap_chown,cap_dac_override,cap_fowner,cap_fsetid,cap_kill,cap_setgid,cap_setuid,cap_setpcap,cap_net_bind_service,cap_net_admin,cap_net_raw,cap_sys_chroot,cap_mknod,cap_audit_write,cap_setfcap
Securebits: 00/0x0/1'b0
 secure-noroot: no (unlocked)
 secure-no-suid-fixup: no (unlocked)
 secure-keep-caps: no (unlocked)
uid=0(root)
gid=0(root)
groups=0(root)
```
and that the same command runs successfully from interactive shell:
```
$ sudo docker run --cap-add CAP_NET_ADMIN -it debian /bin/bash                 
root@ee513136aea5:/# ip link add name br0 type bridge
root@ee513136aea5:/#
```

The behavior however is different when the container does not run as root:
```
$ sudo docker run --user 1000:100 --cap-add CAP_NET_ADMIN -it debian ip link add name br0 type bridge
RTNETLINK answers: Operation not permitted
```
A comparison of the capabilities configuration as root and non-root yields the following:
```
$ diff <(sudo docker run --cap-add CAP_NET_ADMIN -t debian capsh --print ) <(sudo docker run --user 1000:100 --cap-add CAP_NET_ADMIN -t debian capsh --print)   
1c1
< Current: = cap_chown,cap_dac_override,cap_fowner,cap_fsetid,cap_kill,cap_setgid,cap_setuid,cap_setpcap,cap_net_bind_service,cap_net_admin,cap_net_raw,cap_sys_chroot,cap_mknod,cap_audit_write,cap_setfcap+ep
---
> Current: =
7,9c7,9
< uid=0(root)
< gid=0(root)
< groups=0(root)
---
> uid=1000(???)
> gid=100(users)
> groups=100(users)
```

and more in details via `/proc/self/status`:
```
$ sudo docker run --cap-add CAP_NET_ADMIN -t debian cat /proc/self/status | grep Cap
CapInh:	0000000000000000
CapPrm:	00000000a80435fb
CapEff:	00000000a80435fb
CapBnd:	00000000a80435fb
CapAmb:	0000000000000000

$ sudo docker run --user 1000:100 --cap-add CAP_NET_ADMIN -t debian cat /proc/self/status | grep Cap
CapInh:	0000000000000000
CapPrm:	0000000000000000
CapEff:	0000000000000000
CapBnd:	00000000a80435fb
CapAmb:	0000000000000000
```

When the container does not run as root, effective and permitted capabilities are all cleared, while there is
no difference in the binding set. From [docker/labs](https://github.com/docker/labs/blob/master/security/capabilities/README.md) repo, one can read:

> The above command fails because Docker does not yet support adding capabilities to non-root users.

This seems to mach with the output above and this specific behavior for non-root users was introduced by
 [moby/15ff0939](https://github.com/moby/moby/commit/15ff09395c001bcb0f284461abbc404a1d8bab4d), i.e. 
"If container will run as non root user, drop permitted, effective caps early". In particular:
```
        s.Process.Capabilities.Bounding = caplist
        s.Process.Capabilities.Permitted = caplist
        s.Process.Capabilities.Inheritable = caplist
+       // setUser has already been executed here
+       // if non root drop capabilities in the way execve does
+       if s.Process.User.UID != 0 {
+               s.Process.Capabilities.Effective = []string{}
+               s.Process.Capabilities.Permitted = []string{}
+       }
```
Something further to notice is that `CapInh` is also cleared in both cases. This comes instead from [moby/dd38613d](https://github.com/moby/moby/commit/dd38613d0c8974438fa24b63fb6c540a66e7939c), which essentially makes inheritable capabilities irrelevant in all cases. 
```
        if ec.Privileged {
-               if p.Capabilities == nil {
-                       p.Capabilities = &specs.LinuxCapabilities{}
+               p.Capabilities = &specs.LinuxCapabilities{
+                       Bounding:  caps.GetAllCapabilities(),
+                       Permitted: caps.GetAllCapabilities(),
+                       Effective: caps.GetAllCapabilities(),
                }
-               p.Capabilities.Bounding = caps.GetAllCapabilities()
-               p.Capabilities.Permitted = p.Capabilities.Bounding
-               p.Capabilities.Inheritable = p.Capabilities.Bounding
-               p.Capabilities.Effective = p.Capabilities.Bounding
        }
```
Dropping support for inheritable capabilities is a fix for [CVE-2022-24769
](https://github.com/moby/moby/security/advisories/GHSA-2mm7-x5h6-5pvq)
Event though non-root containers have only the bounding set configured, it should be possible for processes
within the container to acquire effective capabilities, by setting `<CAP>+ep` on the executable file. In fact
based on capabilities transformation rules during execve:

```
P'(effective)   = F(effective) ? P'(permitted) : P'(ambient)
```

and permitted capabilities are regulated as follows:

```
P'(permitted)   = (P(inheritable) & F(inheritable)) |
                 (F(permitted) & P(bounding)) | P'(ambient)
```

Given `inheritable` capabilities are always cleared, the new process can acquire permitted capabilities if
the specific capability is set on the executable file, and that permitted can become effective is the effective
bit is enabled. Documentation here becomes misleading, in particular [docker/labs/security/capabilities](https://github.com/docker/labs/blob/master/security/capabilities/README.md)  mentions:

> Docker imposes certain limitations that make working with capabilities much simpler. For example, file capabilities are stored within a file's extended attributes, and extended attributes are stripped out when Docker images are built. This means you will not normally have to concern yourself too much with file capabilities in containers.

A good historical source for xattr support in Docker is [issues/35699](https://github.com/moby/moby/issues/35699). xattr were initially not implemented because AUFS [storage layer did not support them](https://github.com/moby/moby/issues/1070). Regardless of AUFS limitation, there were concerns on how to support heterogenous systems
that might not all support xattr. In [pull/3845](https://github.com/moby/moby/pull/3845), support for 
xattr `security.capabilities` is added to storage layers. The quote above from docker/labs seems to have 
been committed in Oct 2016 with [d9273d2c](https://github.com/docker/labs/commit/d9273d2cbcba20a132a266e4b7c4c6377f475aba). This is two year after [pull/3845](https://github.com/moby/moby/pull/3845). Anyways, `security.capabilities` are indeed preserved at least with `overlay2` storage engine.


`ip` and CAP_NET_ADMIN
=======
I dived into capability support to configure a container for building openembedded images. One of the requirements
I had was the ability to create a qemu bridge networking setup. I needed the ability to create a bridge interface.
So, according to the research presented above, adding `cap_net_admin+ep` to `/bin/ip` should have been
sufficient to manipulate network interfaces without being root. Unfortunately, I was still getting a perimssion
denied.
```
$ sudo docker run --user 1000:100 --cap-add CAP_NET_ADMIN -it oe_build /bin/sh
$ getcap /bin/ip
/bin/ip = cap_net_admin+ep
$ whoami
dev
$ ip link add name br0 type bridge                                  
RTNETLINK answers: Operation not permitted
```

While trying to exactly assess where the "Operation not permitted" was coming from, the following caught my
attention in the `strace` output:
```
getuid()                                = 1000
geteuid()                               = 1000
capget({version=_LINUX_CAPABILITY_VERSION_3, pid=0}, NULL) = 0
capget({version=_LINUX_CAPABILITY_VERSION_3, pid=0}, {effective=0, permitted=0, inheritable=0}) = 0
capset({version=_LINUX_CAPABILITY_VERSION_3, pid=0}, {effective=0, permitted=0, inheritable=0}) = 0
```

This looks a lot like an attempt to assess if the process is running as root, followed by a drop of all 
capabilities. So, even if `cap_net_admin+ep` might be working the `capset` call above makes it a no-op. In fact,
in `iproute2/ip/ip.c` one can see the following excerpt:

```c
if (argc < 3 || strcmp(argv[1], "vrf") != 0 ||
     strcmp(argv[2], "exec") != 0)
 drop_cap();
```

What is tricked `ip` into thinking it is running as root? `fakeroot` does exactly this.


`fakeroot`, `LD_PRELOAD`  and capabilities
=======

The first attempt with `fakeroot` was unsuccessful:

```
$ fakeroot ip link add name br0 type bridge
ERROR: ld.so: object 'libfakeroot-sysv.so' from LD_PRELOAD cannot be preloaded (cannot open shared object file): ignored.
RTNETLINK answers: Operation not permitted
```



{% comment %}
Is d0527e22839a73347b5e723994ebba62e9037051 in containerd going to revert this again?

```
@@ -943,6 +943,11 @@ func WithCapabilities(caps []string) SpecOpts {
                s.Process.Capabilities.Bounding = caps
                s.Process.Capabilities.Effective = caps
                s.Process.Capabilities.Permitted = caps
+               if len(caps) == 0 {
+                       s.Process.Capabilities.Inheritable = nil
+               } else if len(s.Process.Capabilities.Inheritable) > 0 {
+                       filterCaps(&s.Process.Capabilities.Inheritable, caps)
+               }
 
                return nil
        }
@@ -968,6 +973,16 @@ func removeCap(caps *[]string, s string) {
        *caps = newcaps
 }
 
+func filterCaps(caps *[]string, filters []string) {
+       var newcaps []string
+       for _, c := range *caps {
+               if capsContain(filters, c) {
+                       newcaps = append(newcaps, c)
+               }
+       }
+       *caps = newcaps
+}
+
```

Here is ip discussion about dropping all capabilities: https://www.spinics.net/lists/netdev/msg816698.html
We can add set-user-id to fakeroot shared object, as it's not possible to inject into it any malicious behavior.
https://github.com/moby/moby/security/advisories/GHSA-2mm7-x5h6-5pvq

{% endcomment %}
