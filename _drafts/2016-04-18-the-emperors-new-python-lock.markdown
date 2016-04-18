---
layout: post
title:  "The Emperor's new Python lock"
date:   2016-04-17 21:00:00
categories: jekyll update
summary: "I was recently debugging an interesting bug in a software written in Python
that resulted in an insightful debugging session. The root cause of the bug itself
turned out quite trivial, but the discoveries that followed, involving  mainly Python 
multiprocessing lib (Process, Queue) and Python threads, were quite interesting!
Here I have summed up the journey with code written from scratch which is equivalent
to the production system I was working on."
---

Background
=======
The code I was debugging was responsible for gathering the ouput from several 
shell commands and reporting the health of the underlying machine. 
