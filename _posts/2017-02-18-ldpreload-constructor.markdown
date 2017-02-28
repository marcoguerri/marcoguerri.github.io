---
layout: post
title:  "LD_PRELOAD and __attribute__((constructor))"
date:   2017-02-18 08:00:00
published: yes
categories: c linker
pygments: true
summary: "Some notes on LD_PRELOAD,  __attribute__((constructor)) and execve syscall"
---

Introduction
=======

*__attribute__((constructor))* and *__attribute__((destructor))* is a mechanism
that allows to execute functions when loading and unloading ELF executables and shared 
objects. These functions are defined at the translation unit level (object files) 
and referenced in the *.ctor* and *.dtor* sections of the ELF binary. When an object 
is loaded and unloaded, the interpreter specified in the *PT_INTERP* segment 
calls each function pointer present respectively in *.ctor* and *.dtor*. 
This is normally done in *_dl_init* from *ld-linux.so*

When combined with *LD_PRELOAD*, 
everything becomes even more interesting. If *LD_PRELOAD* is set, the dynamic loader 
loads the libraries referenced by that variable before any other shared object and,
as a consequence, constructor functions of those objects are also invoked.

When playing around with *LD_PRELOAD*, I found myself in a situation 
where I could not explain why a constructor function was being called multiple 
times by children processes further down the fork chain.
After a closer look, it turned out those processes were calling *execve* multiple
times, with *LD_PRELOAD* set in *envp* parameter, as it would be expected if the parent
process has been invoked with *LD_PRELOAD*. execve maps the dynamic loader in
the process address space and then relinquishes control to it. Once the loader
is executing, shared libraries are loaded and *.ctor* invoked when necessary.
Hence, multiple execve calls means multiple calls to *__attribute__((constructor))*
functions.

 





.