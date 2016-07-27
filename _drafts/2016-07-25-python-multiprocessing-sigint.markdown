---
layout: post
title:  "Python multiprocessing pools and SIGINT"
date:   2016-07-24 20:00:00
categories: jekyll python
summary: "Diving a little into Python multiprocessing internals following some
          attemps to properly handle SIGINT via KeyboardInterrupt."
---

Background
=======
I was recently using Python *multiprocessing* module to parallelize some workload
and when I finally  got around implementing a proper handling of SIGINT I had the
chance to dig into the standard library to gain a better understanding of what
was happening under the hood. The usecase was rather simple and it could be
summed up as follows:

{% highlight python linenos %}

import multiprocessing
import time
import sys

def worker(*args):
        time.sleep(3)
        print "Hello world {0}".format(args[0])

def run():
    p = multiprocessing.Pool(10)
    r = p.map_async(worker, range(10))
    r.wait(10)
    print "All done"

if __name__ == '__main__':
    run()
{% endhighlight %}

Interrupting the workers
=======

What happens if this code snipped is interrupted with Control-C? First of all, when
typing Control-C the driver of the tty or the terminal emulator will deliver a
SIGINT to all the processes belonging to the foreground process group. The
multiprocessing module, does not perform any particular job control, so all the
workers belong to the process group of the parent which is forking them and they
will all receive a SIGINT. The interpreter will translate the signal into a
KeyboardInterrupt exception, which will walk up the stack and if not handled
will cause a stack trace to be displayed, one for each worker process.

A first approach
=======
So far, so good. Now, let's try a first approach to handle the signals. Here
all the workers catch KeyboardInterrupt, do some cleanup and exit. The parent
instead closes the pool (i.e. no more tasks are submitted to the pool) and
joins the workers (closing the pool is a pre-requisite for joining).

{% highlight python linenos %}
import time
import sys

def worker(*args):
    try:
        time.sleep(3)
        print "Hello world {0}".format(args[0])
    except KeyboardInterrupt, e:
        print "Worker interrupted, cleaning up"
        time.sleep(3)

def run():
    try:
        p = multiprocessing.Pool(100)
        r = p.map_async(worker, range(100))
        # Use timeout or SIGINT will be ignored
        r.wait(10)
        print "All done"
    except KeyboardInterrupt, e:
        p.close()
        p.join()
        print "Parent interrupted"

if __name__ == '__main__':
    run()
{% endhighlight %}

All good, but what if the worker receives a second SIGINT while it is executing
the exception handler? With the code above, everything falls apart.
After the first SIGINT all the workers will proceed to the cleanup control path.
If a second SIGINT is delivered before they exit, an additional KeyboardInterrupt
will be raised, this time unhandled all the way up to the interpreter. Now I would expect
the workers to have exited, but this is not what happens.


{% highlight console  %}
 -python,5354 sig.py
    |-python,5361 sig.py
    |-python,5362 sig.py
    |-python,5363 sig.py
    |-{python},5358
    |-{python},5359
    `-{python},5360
{% endhighlight %}
The parent process, the workers and few other helper threads are still there,
in a condition that appears to be a deadlock. Further SIGINTs will cause
only more stack traces to be printed on the screen.

Tracing the parent
=======
Let's trace the parent and see what it is doing, assuming there are no SIGINTs
delivered. After few calls to *clone* to create the workers, *wait4* is invoked 
as many times as there are child processes. The following is an excerpt from strace output:


{% highlight console  %}
clone(child_stack=0, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x7f79d4b9d9d0) = 6733
wait4(6733, 0x7ffc7ed4c6f4, WNOHANG, NULL) = 0
clone(child_stack=0, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x7f79d4b9d9d0) = 6734
wait4(6733, 0x7ffc7ed4c6f4, WNOHANG, NULL) = 0
wait4(6734, 0x7ffc7ed4c6f4, WNOHANG, NULL) = 0
{% endhighlight %}




