---
layout: post
title:  "On Python threads and Queues"
date:   2016-04-17 21:00:00
categories: jekyll update
summary: "I was recently debugging an interesting issue in a software written in Python
that resulted in an insightful debugging session. The root cause of the bug itself
turned out quite trivial, but all the troubleshooting had to happen while the software
was running on a production machine (not critical, but still), posing therefore 
some interesting challenges. Here I have summed up the journey with code written 
from scratch which is equivalent to the production system I was working on."
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

TIMEOUT = 5
def run_command(q):
    read_size = int(random.random() * 200000)
    p = subprocess.Popen(["cat /dev/urandom | head -c {}".format(read_size)],
                         stdout = subprocess.PIPE,
                         stderr = subprocess.PIPE,
                         shell=True,
                         executable="/usr/bin/zsh")

    # Blocking until EOF
    stdout = p.communicate()[0]
    # Passing stdout to parent via queue
    q.put(stdout)
    sys.stdout.write("All done! Goodbye!\n")

def get_output():
    q = Queue()
    p = Process(target=run_command, args =(q,))
    p.start()
    
    t1 = datetime.datetime.utcnow()
    p.join(TIMEOUT)
    t2 = datetime.datetime.utcnow()
    delta = t2-t1
    sys.stdout.write("Waited the child for {} seconds\n".format(delta.seconds))
    
    res = len(q.get())
    if(p.is_alive()):
        sys.stdout.write("Child is still running...Triggering dosomething()\n")
        dosomething()


def dosomething():
    pass

if __name__ == '__main__':
    print os.getpid()
    get_output()
{% endhighlight %}
The code basically does the following:

 * A parent process *P* spawns a subprocess *S* which executes `run_command` function
 * *S* invokes a shell command which simply prints to stdout some data
   whose size is not predictable. This data is retrieved by *P* through a pipe
 * *P* waits for the child for a specific timeout and retrieves the data being 
 passed via a queue. If *S* is still running, then it assumes something went
 wrong a triggers a timeout procedure

No rocket science, agree. The output would normally be something as follows:

{% highlight console  %}
All done! Goodbye!
Waited the child for 0 seconds
{% endhighlight %}

But every now and then, the following would happen:
{% highlight console  %}
All done! Goodbye!
Waited the child for 5 seconds
Child is still running...Triggering dosomething()
{% endhighlight %}

Even tough the *S* seemed to return correctly, *P* was still
suspending on the join until the timeout. Upon checking that *S* was still alive, it was
triggering sort of a timeout workflow. This issue was spotted because of the high
number of calls to this timeout function.  In hindsight, this bug looks very trivial, but
the code presented above was buried in longer control paths and what was happening 
was not immediately clear to me.


A first non-instrusive look
=======
The first approach was to check the evolution of the process tree during few
runs. This was farily easy to do, as the script was invoked by a 
deamon on which I could call `pstree` in "movie mode".

{% highlight console %}
watch --interval 1 pstree -ap <PID>
{% endhighlight %}

To a certain degree, the result was expected. *P* (16661) was first being spawned 
by the deamon.

{% highlight console %}
python,16661 main.py
{% endhighlight %}

*P* was then spawning *S* (16856), which was in turn calling `subprocess.Popen` 
with`shell=True` and executing the command.

{% highlight console %}
python,16661 main.py                                                            
  `-python,16856 main.py                                                        
      `-zsh,16857 -c cat /dev/urandom | head -c 174784                          
          |-cat,16858 /dev/urandom                                              
          `-head,16859 -c 174784 
{% endhighlight %}

At some point, the shell command was returning, and everything was grinding to
a halt in the following situation:

{% highlight console %}
python,16661 main.py                                                            
  `-python,16856 main.py                                                        
      `-{python},16862
{% endhighlight %}
Despite seeing in the logs the "Goodbye message", which was clearly 
indicating that 16856 was not suspended on `communicate()` (as a matter of fact,
`communicate()` blocks until EOF, i.e. when the pipe is closed, and zsh was 
already gone by now), 16856 was not exiting until the timeout. I could not
immediately understand why, but I definitely could not wrap my head around 
the appearance of somebody new, 16862. Curly braces indicate a thread rather 
then a process, and according to pstree that thread was created by 16856, i.e. 
*S*. I could not find anywhere in the code a call to Python `threading` library
and I really felt uncomfortable not knowing where it was coming from...


A bit deeper
=======
Time came to deploy heavy artillery: `strace`! `ptrace`, the underlying syscall
used by strace has this amazing flag called `PTRACE_ATTACH` which allows to
start tracing a process without it having to call `PTRACE_TRACEME`. With `ptrace`
the workflow would normally be the following (man 2 ptrace for the real fun):
  
  * Parent calls fork() and then waits on the pid of the child for something to
happen
  * Child calls ptrace with `PTRACE_TRACEME`, normally followed by an `execve`
  * At this point the child will stop upon receiving any signal different then 
`SIGKILL` (even if `SIG_IGN`ed). The parent, who should be suspended on `wait`, 
is notified that the child's status has changed. Upon exiting from `waitpid`, 
the parent can use `ptrace` to gather all possible information concerning the 
status of the child, such as the content of the hardware registers. A `SIG_CONT` 
would allow the process to continue.
   * Thanks to `PTRACE_SYSCALL`




  * Parent calls `ptrace` on the child with `PTRACE_SYSCALL`, letting the kernel

