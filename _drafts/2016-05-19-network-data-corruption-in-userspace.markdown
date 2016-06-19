---
layout: post
title:  "Corrupted network data delivered to userspace"
date:   2016-06-19 21:00:00
categories: jekyll update
summary: "TBD"
---

Background
=======

Adding queue discipline with 10% corrupted packets:
sudo tc qdisc add dev lo root netem corrupt 10

To remove the queue discipline
sudo tc qdisc del dev lo root

On the client side:
cat /dev/uraondom | tr -dc "[:alpha:]" or tr -dc  | LD_PRELOAD=./socket.so nc <server-ip> <port>

Then regularly asking it to dump statistics on the packets dropped
pgrep nc | tail -n 1 | xargs -I{} kill -SIGUSR1 {}

On the server simply nc -l 8080


{% highlight python linenos %}
#!/usr/bin/env python
{% endhighlight %}


