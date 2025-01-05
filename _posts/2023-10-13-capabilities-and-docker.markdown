---
layout: post
title:  "CAP_NET_ADMIN for non-root user in Docker container"
date:   2023-10-13 08:00:00
published: true
pygments: true
toc: true
tags: [docker, linux, capabilities]
categories: [Technical]
---

I spent some time trying to get capabilities work in Docker in non-root containers, and it wasn't a smooth journey. 
I either stumbled across documentation that would only cover basic use cases or documentation that was outdated and 
misleading. One possible feedback I would feel like addressing to Docker ecosystem is that it tries to be excessively 
easy for the end user, hiding any possible source of complexity. Sometimes you do need to be exposed to that complexity, 
and you are  completely on your own, with the codebase being the only source to refer to.
In my case, I did have to look into Moby's codebase to understand how permitted, effective, and inheritable capabilities were managed. 
This post is an attempt to summarize what I essentially wished I had known when trying to build a non-root
container with minimal privileges in which additional network interfaces had to be created.

Docker documentation
=======
Starting from [docs.docker.com](https://docs.docker.com/engine/reference/run/#runtime-privilege-and-linux-capabilities), 
one is pointed to `--cap-add` and `--cap-drop` to implement fined grain control over which capabilities are given to the 
container:

> In addition to --privileged, the operator can have fine grain control over the capabilities using --cap-add and --cap-drop. By default, Docker has a default list of capabilities that are kept. The following table lists the Linux capability options which are allowed by default and can be dropped.

By itself, I find this already very confusing. There are multiple set of capabilities assigned to a process, i.e.
`permitted`, `effective`, `inheritable`. These are not mentioned anywhere in Docker documentation. From the docker/labs 
repo, there seems to be [additional documentation on capabilities](https://github.com/docker/labs/blob/master/security/capabilities/README.md), that however appears outdated. It's useful to try rebuilding the history of capabilities management in 
Docker to see how support has evolved over time.


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
As `CAP_NET_ADMIN` is necessary to manipulate network interfaces, `ip` command fails. Adding
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
no difference in the binding set. [docker/labs](https://github.com/docker/labs/blob/master/security/capabilities/README.md) repo, mentions the following:

> The above command fails because Docker does not yet support adding capabilities to non-root users.

This seems to be coherent with the output above. This specific behavior for non-root users was introduced by
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
](https://github.com/moby/moby/security/advisories/GHSA-2mm7-x5h6-5pvq).
Event though non-root containers have only the bounding set configured, it should be possible for processes
within the container to acquire effective capabilities, by setting `<CAP>+ep` on the executable file:
* Effective bit (`e` is just a single bit on files) is set, during `execve` all of the permitted capabilities for the thread
are also mirrored in the effective set.
*  `CAP` is set as permitted capability

Capabilities transformation rules during execve are the following:

```
P'(effective)   = F(effective) ? P'(permitted) : P'(ambient)
```

and permitted capabilities are regulated as follows:

```
P'(permitted)   = (P(inheritable) & F(inheritable)) |
                 (F(permitted) & P(bounding)) | P'(ambient)
```

If we had `F(effective)` set, then `P'(effective)` would become `P'(permitted)`, as just mentioned above.
The content of `P'(permitted)` effectively depends on `(F(permitted) & P(bounding)) | P'(ambient`, given
 `inheritable` capabilities are always cleared, If `CAP` is set on the file as permitted, given `P(bounding)` is already set to `caps.GetAllCapabilities()`,
then `CAP` should be acquired as `P'(permitted)` and consequentely as `P'(effective).
Documentation here becomes misleading, in particular [docker/labs/security/capabilities](https://github.com/docker/labs/blob/master/security/capabilities/README.md)  mentions the following:

> Docker imposes certain limitations that make working with capabilities much simpler. For example, file capabilities are stored within a file's extended attributes, and extended attributes are stripped out when Docker images are built. This means you will not normally have to concern yourself too much with file capabilities in containers.

A good historical source for xattr support in Docker is [issues/35699](https://github.com/moby/moby/issues/35699). xattr were initially not implemented because AUFS [storage layer did not support them](https://github.com/moby/moby/issues/1070). Regardless of AUFS limitation, there were concerns on how to support heterogenous systems
that might not all support xattr. In [pull/3845](https://github.com/moby/moby/pull/3845), support for 
xattr `security.capabilities` is added to storage layers. The quote above from docker/labs seems to have 
been committed in Oct 2016 with [d9273d2c](https://github.com/docker/labs/commit/d9273d2cbcba20a132a266e4b7c4c6377f475aba). This is two year after [pull/3845](https://github.com/moby/moby/pull/3845). Anyways, `security.capabilities` are indeed preserved at least with `overlay2` storage engine.


`ip` and CAP_NET_ADMIN
=======
I dived into capability support to configure a container for building Openembedded images. One of the requirements
I had was the ability to create a qemu bridge networking setup. According to the research presented above, 
adding `cap_net_admin+ep` to `/bin/ip` (effective bit set, capability set as permitted on the file) should have been
sufficient to manipulate network interfaces without being root. Unfortunately, I would still get a permission denied error:
```
$ sudo docker run --user 1000:100 --cap-add CAP_NET_ADMIN -it oe_build /bin/sh
$ getcap /bin/ip
/bin/ip = cap_net_admin+ep
$ whoami
dev
$ ip link add name br0 type bridge                                  
RTNETLINK answers: Operation not permitted
```

While trying to assess where exactly the "Operation not permitted" was coming from, the following caught my
attention in the `strace` output:
```
getuid()                                = 1000
geteuid()                               = 1000
capget({version=_LINUX_CAPABILITY_VERSION_3, pid=0}, NULL) = 0
capget({version=_LINUX_CAPABILITY_VERSION_3, pid=0}, {effective=0, permitted=0, inheritable=0}) = 0
capset({version=_LINUX_CAPABILITY_VERSION_3, pid=0}, {effective=0, permitted=0, inheritable=0}) = 0
```

This looks a lot like an attempt to assess if the process is running as root, followed by a drop of all 
capabilities. So, even if `cap_net_admin+ep` might be working, the `capset` call above makes it a no-op. In fact,
in `iproute2/ip/ip.c` (> `v4.16`) one can see the following excerpt:

```c
if (argc < 3 || strcmp(argv[1], "vrf") != 0 ||
     strcmp(argv[2], "exec") != 0)
 drop_cap();
```

Certainly in this case `strcmp(argv[1], "vrf") != 0` is true, so we end up dropping all capabilities.
`drop_cap` is implemented as follows:
```c
void drop_cap(void)
{
#ifdef HAVE_LIBCAP
    /* don't harmstring root/sudo */
    if (getuid() != 0 && geteuid() != 0) { 
        cap_t capabilities;
        cap_value_t net_admin = CAP_NET_ADMIN;
        cap_flag_t inheritable = CAP_INHERITABLE;
        cap_flag_value_t is_set;

        capabilities = cap_get_proc();
        if (!capabilities)
            exit(EXIT_FAILURE);
        if (cap_get_flag(capabilities, net_admin, inheritable,
            &is_set) != 0)
            exit(EXIT_FAILURE);
        /* apps with ambient caps can fork and call ip */
        if (is_set == CAP_CLEAR) {
            if (cap_clear(capabilities) != 0)
                exit(EXIT_FAILURE);
            if (cap_set_proc(capabilities) != 0)
                exit(EXIT_FAILURE);
        }    
        cap_free(capabilities);
    }    
#endif
}
```

This checks if we are running as normal user (user and effective user id are != 0) and whether the process
has `CAP_NET_ADMIN` set in the inheritable set, which is the case. If so, all capabilities are dropped,
hence setting `cap_net_admin+ep` on `ip` becomes a no-op.

`fakeroot` and `LD_PRELOAD`
=======

My first attempt to bypass `drop_cap` consisted in running `ip` under `fakeroot`, an `LD_PRELOAD`
shared library which overwrites some `libc` calls to either make userspace believe we are running as root
(e.g. by overwriting `getuid`, `geteuid` to return 0) or record that some operations (e.g. `open` + `O_CREAT`) should 
look  like as they have been performed as root to other userspace tools such as `tar`. The process that is being 
fakeroot-ed remains effectively unprivileged. I did not have much success:

```
$ fakeroot ip link add name br0 type bridge
ERROR: ld.so: object 'libfakeroot-sysv.so' from LD_PRELOAD cannot be preloaded (cannot open shared object file): ignored.
RTNETLINK answers: Operation not permitted
```

The error is definitely obscure, and `LD_DEBUG=all` doesn't provide much more information. `ld.so` code
itself is not incredibly eloquent:

```c
unsigned int old_nloaded = GL(dl_ns)[LM_ID_BASE]._ns_nloaded;

(void) _dl_catch_error (&objname, &err_str, &malloced, map_doit, &args);
if (__glibc_unlikely (err_str != NULL))
{
    _dl_error_printf("\
        ERROR: ld.so: object '%s' from %s cannot be preloaded (%s): ignored.\n",
        fname, where, err_str);
```

`ld.so` documentation explains why the dynamic linker is failing, even 
though the error which is surfaced is aboslutely ambiguous.

```
Secure-execution mode
For security reasons, if the dynamic linker determines that a binary
should be run in secure-execution mode, the effects of some environment
variables are voided or modified, and furthermore those environment 
variables are stripped from the environment, so that the program does 
not even see the definitions. Some of these environment variables affect 
the operation of the dynamic linker itself, and are described below.
Other environment variables treated in this way include: GCONV_PATH, 
GETCONF_DIR, HOSTALIASES, LOCALDOMAIN, LOCPATH, MALLOC_TRACE, NIS_PATH, 
NLSPATH, RESOLV_HOST_CONF, RES_OPTIONS, TMPDIR, and TZDIR.
```

We are in secure mode if the `AT_SECURE` entry in the auxiliary vector has a nonzero value. 
This might happen in one of the following scenario:
* The process's real and effective user IDs differ, or the real and effective group IDs differ. 
This typically occurs as a result of executing set-user-ID or set-group-ID program.
* A process with a non-root user ID executed a binary that conferred capabilities to the process.
* A nonzero value may have been set by a Linux Security Module

We are trying to assign capabilities to the process, so we fall within the the second use case.
For `LD_PRELOAD`, which is effectly what `fakeroot` uses, documentation further explains the
limitations in secure-execution mode:

```
In secure-execution mode, preload pathnames containing slashes are ignored. 
Furthermore, shared objects are preloaded only from the standard search 
directories and only if they have set-user-ID mode bit enabled (which is 
not typical).
```

`fakeroot` lib happens to be in a non-standard path in `/usr/lib/x86_64-linux-gnu/libfakeroot/libfakeroot-sysv.so`,
neither does it have `SUID` set, so `ld.so` will refuse to preload it. Note also that `LD_DEBUG` won't work in 
secure-execution mode unless `/etc/suid-debug` is present on the filesystem.

Alternatives to `fakeroot`
=======
We could force `ip` not to clear capabilities by starting the container as root, retain `CAP_NET_ADMIN` as inheritable 
through `capsh` and drop privileges ourselves instead of asking Docker to do it.

```
capsh --keep=1 --user=dev --inh=cap_net_admin=i --
```

This works, but would be a regression with respect to [CVE-2022-24769](https://nvd.nist.gov/vuln/detail/cve-2022-24769),
as the container would not start with empty inheritable capabilities. It would also result in dropping privileges relatively
late, compared to starting the container as unprivileged user.

Preferred method
=======
According to the commit which introduced `drop_cap` in `iproute2` ([ba2fc55b](https://git.kernel.org/pub/scm/network/iproute2/iproute2.git/commit/?id=ba2fc55b99f8363c80ce36681bc1ec97690b66f5)), capabilities are dropped so that users can safely 
add caps to the binary for `ip vrf exec`. I am unclear why only the `vrf` use case would be considered as requiring 
`CAP_NET_ADMIN`, `CAP_SYS_ADMIN` and `CAP_DAC_OVERRIDE`, while forcing everything else to use root, modulo the check on
the inheritable set).

Starting the container with `CAP_SYS_ADMIN` as inheritable capability is a regression with respect to 
[CVE-2022-24769](https://nvd.nist.gov/vuln/detail/cve-2022-24769), but I still consider it preferable compared
to the fragile `LD_PRELOAD` approach. Based on my current understanding, the risks coming from a binary
having a file inheritable capability set and acquiring it in the process permitted set is equivalent to the
binary having the same capability set as permitted.
