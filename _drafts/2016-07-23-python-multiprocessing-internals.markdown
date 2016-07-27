---
layout: post
title:  "Python multiprocessing internals: lifetime of a Process"
date:   2016-07-24 20:00:00
categories: jekyll python multiprocessing
summary: "Few notes on the inner mechanisms that regulate the lifetime
of a Python multiprocessing.Process"
---

Background
=======
Let's consider the following snippet of code, where the main thread spawns
a worker node that requires some time to terminate.

{% highlight python linenos %}
from multiprocessing import Process
import time

def worker():
    time.sleep(10)
    print "Worker process"

p = Process(target=worker)
p.start()
print "All done"
{% endhighlight %}
When that code is executed, "All done" is immediately printed, then there is
a 10 seconds delay followed by the message "Worker Process". What happens when
the process is created and especially why the interpreter does not return until
the worker has completed the execution?

A deeper look: strace
=======
Let's start with heavy artillery straight away, i.e. *strace*. It might be a bit
of an overkill to trace the interpreter in order to understand what happens at
the Python multiprocessing library level, but I find it always very insightful.
Clearly I will skip the uninteresting parts and jump right to the relevant pieces.
Since I want to see what both the parent and the child are doing, the *-f* flag
is mandatory. The process is initially created via *clone* syscall.

{% highlight console linenos %}
clone(child_stack=0, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x7f875c1ce9d0) = 5337
Process 5337 attached
[...]
[pid  5337] select(0, NULL, NULL, NULL, {10, 0}) = 0 (Timeout)
[pid  5337] fstat(1, {st_mode=S_IFCHR|0620, st_rdev=makedev(136, 2), ...}) = 0
[pid  5337] mmap(NULL, 4096, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0) = 0x7f875c1f6000
[pid  5337] write(1, "Worker process\n", 15Worker process

{% endhighlight %}
The absence of *CLONE_VM* (to enable sharing page tables) and *CLONE_FS* (to enable
sharing the *fs_struct*  in *task_struct* containing root, pwd, umask, etc) when
invoking *clone* clearly indicates that a new process is being created rather than a 
thread. *SIGCHLD* is also set, therefore a signal will be delivered to the parent upon 
exiting. The child then waits 10 seconds via *select* syscall and finally prints its 
message. What is the parent doing meanwhile?

{% highlight console linenos %}
[pid  5336] write(1, "All done\n", 9All done
)   = 9
[pid  5337] open("/dev/null", O_RDONLY) = 3
[pid  5337] fstat(3, {st_mode=S_IFCHR|0666, st_rdev=makedev(1, 3), ...}) = 0
[pid  5336] wait4(5337, 0x7ffcf60020d4, WNOHANG, NULL) = 0
[pid  5336] wait4(5337, 0x7ffcf60020d4, WNOHANG, NULL) = 0
[pid  5336] wait4(5337,  <unfinished ...>
[...]
<... wait4 resumed> [{WIFEXITED(s) && WEXITSTATUS(s) == 0}], 0, NULL) = 5337
--- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_pid=5337, si_uid=1000, si_status=0, si_utime=0, si_stime=0} ---
{% endhighlight %}
After printing its message on standard output, it starts a series of non-blocking
wait on the child setting *WNOHANG* flag, which causes the syscall to return immediately 
if the child hasn't exited yet (by default *wait4* behaves as *waitpid*, i.e. returns
only if the waited process has exited). A SIGCHLD is then sent by the child, but 
given that the default policy for this signal is "ignore", there is no side effect 
on the parent (no *EINTR* nor *SA_RESTART*).  wait4 returns the pid of 
the process which was being waited. How is this behavior
triggered in the multiprocessing library? Well, it's not immediately obvious: normally 
Python code is debugged with pdb, but here it does really prove useful. I had this
crazy idea to trace the interpreter with gdb and I was positively surprised to see
how easy it was.


Going deeper: gdb
=======
First, python's debug symbols must be installed. On Debian,
*python-dbg* contains the interpreter compiled with *-g* option. On Fedora,
debug symbols can be downloaded separately with the following command:
{% highlight console linenos %}
yum --enablerepo=fedora-debuginfo install python-debuginfo
{% endhighlight %}

Note however that the package with debug symbols must match the version of
the "plain" package: a mismatch will prevent gdb from loading the symbols.
This mechanism is a bit different between Debian and Fedora. In fact, under Fedora
the package *python-debug* contains an executable that does not have debug symbols,
but it has been compiled with internal debug features useful when developing for
example extension for the interpreter. Debug symbols must again be installed
separately.

