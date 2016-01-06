---
layout: post
title:  "Tale of a bug: livecd-tools and ***** FILE SYSTEM WAS MODIFIED ***** "
date:   2016-01-06 08:00:00
published: false
categories: jekyll update
pygments: true
summary: "I recently stumbled across a tricky problem (not really a bug, to be fair)
while creating a Linux live image with livecd-tools, a tool for building live CDs using yum. 
In this post I summarize all the steps that allowed me to nail down the root cause of the issue."
---

The issue
=======
livecd-tools is a set of scripts written in Python that, together with 
python-imgcreated, allow the creation of a live image that can be written on a CD or PXE 
booted from the network. In order to create the filesystem for the live environment, 
livecd-tools dumps a file which is then associated to a loopback device, formated with ext3, loopback mounted
in a temporary working area and then populated with the all the selected packages 
in a chrooted enviroment.



{% highlight console lineos %}
livecd-tools 1:13.4.8-1.el6
python-imgcreate 1:13.4.8-1.el6
{% endhighlight %}


