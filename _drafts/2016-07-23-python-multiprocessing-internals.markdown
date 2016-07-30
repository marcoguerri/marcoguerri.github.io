---
layout: post
title:  "Python multiprocessing internals: lifetime of a Process"
date:   2016-07-24 20:00:00
categories: jekyll python multiprocessing
summary: "Few notes on the mechanisms that regulate the lifetime
of a Python multiprocessing.Process, investigating in particular what happens
when the interpreter terminates"
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

A deeper look with strace
=======
Let's start with heavy artillery straight away, i.e. *strace*. It might be a bit
of an overkill to trace the interpreter in order to understand what happens at
the Python multiprocessing library level, but I find it always very insightful.
Clearly I will skip the uninteresting parts and jump right to the relevant pieces.
Since I want to see what both the parent and the child are doing, the *-f* flag
is mandatory. The worker process is initially created via *clone* syscall.

{% highlight console linenos %}
clone(child_stack=0, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x7fca99ea09d0) = 17498
Process 17498 attached
[...]
[pid 17498] select(0, NULL, NULL, NULL, {10, 0}) = 0 (Timeout)
[pid 17498] fstat(1, {st_mode=S_IFCHR|0620, st_rdev=makedev(136, 6), ...}) = 0
[pid 17498] mmap(NULL, 4096, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0) = 0x7fca99ec8000
[pid 17498] write(1, "Worker process\n", 15Worker process

{% endhighlight %}
The absence of *CLONE_VM* (to enable sharing page tables) and *CLONE_FS* (to enable
sharing the *fs_struct*  in *task_struct* containing root, pwd, umask, etc) when
invoking *clone* clearly indicates that a new process is being created rather than a 
thread. *SIGCHLD* is also set, therefore a signal will be delivered to the parent upon 
exiting. The child then waits 10 seconds via *select* syscall and finally prints its 
message. What is the parent doing meanwhile?

{% highlight console linenos %}
[pid 17497] write(1, "All done\n", 9All done
)   = 9
[pid 17497] wait4(17498, 0x7ffc65a9aab4, WNOHANG, NULL) = 0
[pid 17497] wait4(17498, 0x7ffc65a9aab4, WNOHANG, NULL) = 0
[pid 17497] wait4(17498,  <unfinished ...>
<... wait4 resumed> [{WIFEXITED(s) && WEXITSTATUS(s) == 0}], 0, NULL) = 17498
--- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_pid=17498, si_uid=1000, si_status=0, si_utime=0, si_stime=0} ---
rt_sigaction(SIGINT, {SIG_DFL, [], SA_RESTORER, 0x7fca99a9d8d0}, {0x559f50, [], SA_RESTORER, 0x7fca99a9d8d0}, 8) = 0
[...]
exit_group(0)                           = ?
{% endhighlight %}
After printing its message on standard output, it starts a series of non-blocking
wait on the child setting *WNOHANG* flag, which causes the syscall to return immediately 
if the child hasn't exited yet (by default *wait4* behaves as *waitpid*, i.e. returns
only if the waited process has exited). A SIGCHLD is then sent by the child, but 
given that the default policy for this signal is "ignore", there is no side effect 
on the parent (no *EINTR* nor *SA_RESTART*).  wait4 returns the pid of 
the process which was being waited. It is interesting now to see how this behavior
is triggered in the multiprocessing library, since it is not immediately obvious
(shouldn't the interpreter just return after the final statement?).
Normally Python code is debugged with pdb, but here it does not really prove useful. 
I had this crazy idea to trace the interpreter with gdb and I was positively surprised 
to see how easy it was.


Tracing with gdb
=======
First, python's debug symbols must be installed. On Debian,
*python-dbg* contains the interpreter compiled with *-g* option. On Fedora,
debug symbols can be downloaded separately with the following yum command:
{% highlight console %}
yum --enablerepo=fedora-debuginfo install python-debuginfo
{% endhighlight %}

Note however that the package with debug symbols must match the version of
the "plain" package: a mismatch will prevent gdb from loading the symbols.
This mechanism is a bit different between Debian and Fedora. In fact, under Fedora
the package *python-debug* contains an executable that does not have debug symbols,
but it has been compiled with internal debug features useful when developing for
example extension for the interpreter. Therefore debug symbols must be installed
separately. Since I am interested in seeing what happens just before the interpreter
exits, I need to get a backtrace at the right moment. Breaking at the *exit_group* (syscall 0xE7)
invocation would not help, as by that time the stack has already been unwound
and only the outermost libc frames are still present, i.e *_start*, *__libc_start_main*
and few more. The best choice is probably to trap *wait4* syscall to understand
what control path led to its invocation. It is very easy to break on a specific 
syscall with gdb and to check which control path led there with *bt* command,
which by defaults show only the trace of the current process.

{% highlight console linenos %}
(gdb) catch syscall wait4
Catchpoint 1 (syscall 'wait4' [61])
(gdb) run test.py
Starting program: /usr/bin/python-dbg test.py
[Thread debugging using libthread_db enabled]
Using host libthread_db library "/lib/x86_64-linux-gnu/libthread_db.so.1".
All done

Catchpoint 1 (call to syscall wait4), 0x00007ffff7bce47c in __libc_waitpid (pid=18368, stat_loc=0x7fffffffd16c, options=1) at ../sysdeps/unix/sysv/linux/waitpid.c:31
{% endhighlight %}


Backtracing
=======
Since I am tracing the Python interpreter I am expecting to see invocation of 
CPython internal methods. However, gdb is extremely smart and helps a lot in mapping 
what is happening in the Python interpreter with the high level source code. 
I have trapped a *wait4* invocation, so the first item I expect to see is a libc 
control path that indeed leads to that syscall:

{% highlight console linenos %}
#0  0x00007ffff7bce47c in __libc_waitpid (pid=19042, stat_loc=0x7fffffffd16c, options=1) at ../sysdeps/unix/sysv/linux/waitpid.c:31
#1  0x00000000005f69d4 in posix_waitpid (self=0x0, args=(19042, 1)) at ../Modules/posixmodule.c:6207
{% endhighlight %}

Great. Now, what led to that invocation?

{% highlight console linenos %}
#3  0x000000000052b7f6 in call_function (pp_stack=0x7fffffffd2e0, oparg=2) at ../Python/ceval.c:4033
#4  0x00000000005266ca in PyEval_EvalFrameEx (
    f=Frame 0xa3f610, for file /usr/lib/python2.7/multiprocessing/forking.py, line 135, in poll (self=<Popen(returncode=None, pid=19042) at remote 0x7ffff6a263e0>, flag=1), throwflag=0)
    at ../Python/ceval.c:2679
{% endhighlight %}
*PyEval_EvalFrameEx* is the huge infinite for loop that constitutes the core of
the Python interpreter. Basically it goes through the byte code an interprets/executes
all the Python machine level instructions. This function is called with a *PyFrameObject*
that represents the execution frame in which an instruction is being run. The *PyFrameObject*
is created upon invoking a function and all the instructions in that function are 
executed in that context. A *PyFrameObject* contains all the information needed to
link Python machine level instructions to the high level source code. gdb is very
smart and extract this information automatically pointing us to the source file 
and the line number:

{% highlight console linenos %}
f=Frame 0xa3f610, for file /usr/lib/python2.7/multiprocessing/forking.py, line 135,
{% endhighlight %}
Just for the sake of curiosity, let's try to extract this information manually.
The *PyFrameObject* contains the following interesting items:

  * *f_lineno* member which represents the initial line of the source code associated with the 
    *PyFrameObject* 
  * *f_code*, which is a pointer to a *PyCodeObject* representing the bytecode
being executed. 
  * *f_code->co_filename*  which is a pointer to a *PyObject*
  that represents the name of the source file from which the code object was loaded.
  * *f_code->co_name* which is a pointer to a *PyObject* representing the name
  of the function to which the bytecode belongs

The inspection of these values leads to the following results:
{% highlight console linenos %}
(gdb) x/s ((PyStringObject*)f->f_code->co_filename)->ob_sval
0x7ffff6a2075c: "/usr/lib/python2.7/multiprocessing/forking.py"
(gdb) x/s ((PyStringObject*)f->f_code->co_name)->ob_sval
0x7ffff6ce8d94: "poll"
(gdb) p f->f_lineno
$3 = 131
{% endhighlight %}

that definitely matches the actual Python source code from forking.py.

{% highlight Python linenos %}
131         def poll(self, flag=os.WNOHANG):                                        
132             if self.returncode is None:                                         
133                 while True:                                                     
134                     try:                                                        
135                         pid, sts = os.waitpid(self.pid, flag) 
{% endhighlight %}

The actual source code line that corresponds to the bytecode instruction begin
executed is a bit more tricky to obtain, but the interpreter abstracts all the 
complexity by providing *PyFrame_GetLineNumber*.

{% highlight console linenos %}
(gdb) p PyFrame_GetLineNumber(f)
$4 = 135
{% endhighlight %}

Exactly what gdb already told us.
After this little digression, let's go back to the stack trace. The *poll* function
is a method of *Popen* class in multiprocessing lib. The previous invocation of 
*PyEval_EvalFrameEx* points to process.py.

{% highlight console  %}
#8  0x00000000005266ca in PyEval_EvalFrameEx (
    f=Frame 0x7ffff6cd9a10, for file /usr/lib/python2.7/multiprocessing/process.py, line 79, in _cleanup (p=<Process(_daemonic=False, _target=<function at remote 0x7ffff6ee2648>, _args=(), _tempdir=None, _name='Process-1', _authkey=<AuthenticationString at remote 0x7ffff7e57880>, _parent_pid=19038, _kwargs={}, _identity=(1,), _popen=<Popen(returncode=None, pid=19042) at remote 0x7ffff6a263e0>) at remote 0x7ffff6ca4610>), throwflag=0) at ../Python/ceval.c:2679
{% endhighlight %}

*poll* is invoked in *_cleanup*, which looks for child processes
of the current process that have finished.

{% highlight Python linenos %}
def _cleanup():                                                                 
    # check for processes which have finished                                   
    for p in list(_current_process._children):                                  
        if p._popen.poll() is not None:                                         
            _current_process._children.discard(p)
{% endhighlight %}

Further down in the stack there another pointer to process.py

{% highlight console  %}
#11 0x00000000005266ca in PyEval_EvalFrameEx (f=Frame 0x7ffff6cfcba0, for file /usr/lib/python2.7/multiprocessing/process.py, line 69, in active_children (), throwflag=0)
    at ../Python/ceval.c:2679
{% endhighlight %}

*_cleanup* is called in *active_children*.

{% highlight Python linenos %}
def active_children():                                                          
    '''                                                                         
    Return list of process objects corresponding to live child processes           
    '''                                                                         
    _cleanup()                                                                  
    return list(_current_process._children)
{% endhighlight %}

Next frame points to util.py

{% highlight console %}
#14 0x00000000005266ca in PyEval_EvalFrameEx (
    f=Frame 0xacf490, for file /usr/lib/python2.7/multiprocessing/util.py, line 318, in _exit_function (info=<function at remote 0x7ffff6ce3648>, debug=<function at remote 0x7ffff6ce35a0>, _run_finalizers=<function at remote 0x7ffff6c9f840>, active_children=<function at remote 0x7ffff6ee2990>, current_process=<function at remote 0x7ffff6ee28e8>), throwflag=0)
    at ../Python/ceval.c:2679
{% endhighlight %}

*active_children* is called in *_exit_function*:

{% highlight Python linenos %}
def _exit_function(info=info, debug=debug, _run_finalizers=_run_finalizers,        
                   active_children=active_children,                             
                   current_process=current_process):
        [...]
        for p in active_children():                                             
            if p._daemonic:                                                     
                info('calling terminate() for daemon %s', p.name)               
                p._popen.terminate()
{% endhighlight %}

Next frame points to atexit.py and this is where the journey ends.

{% highlight console %}
#19 0x0000000000526982 in PyEval_EvalFrameEx (
    f=Frame 0xaa5cb0, for file /usr/lib/python2.7/atexit.py, line 24, in _run_exitfuncs (exc_info=None, func=<function at remote 0x7ffff6c9fcd8>, targs=(), kargs={}), throwflag=0)
    at ../Python/ceval.c:2718
{% endhighlight %}

What is atexit.py? From Python documentation:

{% highlight console %}

The atexit module defines a single function to register cleanup functions. 
Functions thus registered are automatically executed upon normal interpreter 
termination. atexit runs these functions in the reverse order in which they 
were registered; if you register A, B, and C, at interpreter termination time 
they will be run in the order C, B, A.

{% endhighlight %}

In util.py:330, the module register *_exit_function* within atexit:


{% highlight python %}
atexit.register(_exit_function)
{% endhighlight %}
