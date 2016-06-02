---
layout: post
title:  "On Python threads and Queues"
date:   2016-04-17 21:00:00
categories: jekyll update
summary: "I was recently debugging an interesting issue in a software written in Python
that resulted in an insightful debugging session. The root cause of the bug itself
turned out quite trivial, but all the troubleshooting had to happen while the software
was running on a production machine, posing therefore some interesting challenges.
Here I have summed up the journey with code written from scratch which is equivalent
to the production system I was working on."
---

Background
=======
The code I was debugging was responsible for gathering the output from several 
shell commands and reporting the health of the underlying machine. It could be
simplified as follows:

{% highlight python linenos %}
#!/usr/bin/env python
import sys
import os
import time
import subprocess
import datetime
import time
import random
from multiprocessing import Queue, Process

TIMEOUT = 10

def run_command(q):
    sys.stdout.write("CHILD: PID is %d\n" % os.getpid())
    read_size = 135000
    p = subprocess.Popen(["cat /dev/urandom | head -c %d" % read_size], 
                         stdout = subprocess.PIPE,
                         stderr = subprocess.PIPE,
                         shell=True,
                         executable="/usr/bin/zsh")

    # Blocking until EOF
    stdout = p.communicate()[0]
    # Passing stdout to parent via queue
    q.put(stdout)
    sys.stdout.write("CHILD: All done! Goodbye!\n")

def get_output():
    sys.stdout.write("PARENT: PPID is %d\n" % os.getpid())
    q = Queue()
    p = Process(target=run_command, args =(q,))
    p.start()
    sys.stdout.write("PARENT: Now joining process\n")
    t1 = datetime.datetime.utcnow()
    p.join(TIMEOUT)
    t2 = datetime.datetime.utcnow()
    delta = t2-t1

    sys.stdout.write("PARENT: Waited the child for %s\n" % delta.seconds)

    if(p.is_alive()):
        sys.stdout.write("PARENT: Child is alive?\n")
    else:
        sys.stdout.write("PARENT: Child process is gone")

    sys.stdout.write("PARENT: Received %s bytes\n" % len(q.get()))

if __name__ == '__main__':
    get_output()

{% endhighlight %}
The code basically does the following:

 * A parent process spawns a child which executes `run_command` function
 * The child invokes a shell command which simply returns to the parent a payload 
   of binary data of a non predictable size (here it's simplified)
 * The parent waits for the child for a specific timeout (line 35)  and retrieves 
   the data being passed

No rocket science, agree. The output was normally something as follows:

{% highlight console linenos %}
PARENT: PPID is 8648
PARENT: Now joining process
CHILD: PID is 8649
CHILD: All done! Goodbye!
PARENT: Waited the child for 0
PARENT: Child process is gone
PARENT: Received 256 bytes
{% endhighlight %}

But every now and then, the following would happen:
{% highlight console linenos %}
PARENT: PPID is 8704
PARENT: Now joining process
CHILD: PID is 8705
CHILD: All done! Goodbye!
PARENT: Waited the child for 10
PARENT: Child is alive?
PARENT: Received 135000 bytes
{% endhighlight %}

Even tough the child seemed to return correctly (line 4), the parent was still
joining it until the timeout. In hindsight, this bug looks very trivial, but
the code presented above was buried in longer control paths and what was happening 
was not immediately clear to me.

