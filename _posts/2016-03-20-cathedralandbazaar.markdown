---
layout: books 
title:  "The Cathedral and the Bazaar"
date:   2016-03-20 20:00:00
categories: books
keywords: Books
intro:  "The Cathedral and the Bazaar was written by Eric Raymond at the end 
of the '90s in the form of an essay, and it was published in 1999 as part of a 
larger collection of writings from Raymond himself that was named after the 
title of its first and foremost part, precisely \"The Cathedral and the Bazaar\". 
The book has become a widely known classic 
on the complex mechanisms that regulate software development and software engineering, 
especially from the point of view of the Open Source community. No wonder why 
this book has become a classic of computer science literature: it's an extremely 
informative and thorough analysis of a topic that is often overlooked when it 
comes to software, that is, how people work and collaborate."
cover: https://covers.openlibrary.org/b/id/805932-M.jpg
published: Yes
---

The Hacker culture had its origins at the MIT Railroad club, at the beginning of the
'60s, at the time of the adoption of the <b>DEC PDP-1, 1961</b>. Few years later,
in <b>1967, the DEC PDP-10</b> was adopted. MIT develops its own OS for he PDP-10,
the Incompatible Time Sharing, written in Assembly and running software written mostly
Lisp. In <b>1969, ARPANET</b> was
launched, the first packet switched network consisting of  universities and research institutes.
In the same year, Ken Thomson and Dennis Ritchie (who had been working on Multics for
Bell Labs at AT&T), wrote Unix. The C Language was specifically created for use under Unix
(and to write Unix itself!). Workhorse machines of early Unix culture where the <b>PDP-11</b>
and <b>VAX</b>. At the beginning of the '80s, the three main cultures on the scene were:
 
 * PDP-10, Incompatible Time Sharing and Lisp
 * PDP-11, Unix and C
 * Early personal computer adopters (IBM 5550 was introduced in 1983)

Unix started to be licenced by AT&T to third parties at the end of the '70s, leading
to a large ecosystem of academic and proprietary versions. The <b>Berkley variant of Unix, BSD, </b> 
running on VAX became the hacking system par excellence. In 1984, Unix became 
a supported AT&T product and the whole decade was basically marked by the rivalry 
between Berkley Unix and AT&T version. Richard Stallman started to write a Unix 
clone in C in 1982, GNU, mainly to create a software strictly linked to the
four essential freedoms listed in the GNU Manifesto.   

As of the beginning of 1990, the workstation market started to be threatened by personal 
computers based on the Intel 386 processor. Individual hackers could afford such 
machines, but the software landscape was not in good shape. Commercial Unixes were still expensive: some
companies attempted to distribute AT&T or BSD Unix ports for PC-class machines, but 
success was extremely scarce. Sources were not distributed with the OS, and this
was clearly not what hackers wanted. The fragmented landscape of proprietary Unix
version failed to compete with Microsoft's Windows OS, which, albeit inferior,
grabbed a large share of the market.

The following chapter is dedicated to Eric Raymond's famous essay, "The Cathedral
and the Bazaar". Here he shares some aphorism on software development directly connected
to his experience that help understand why the Linux community succeeds in creating 
such a large amount of good software. I have reported some of those I considered 
the most relevant for me.


<b> Good programmers known what to write, great ones know what to rewrite (and
reuse).</b>Sharing source code allows other programmers to use your code base to
kickstart new projects. Results is what matters, not effort: starting from a partial
solution is better than starting from nothing at all, reusing and adapting is what
great programmers do.

<b> A good understanding of a problem is not achieved until after a solution is found</b>.
Therefore, it's inevitable start over at least once to get it right.

<b>Treating your users as co-developers is your least-hassle route to rapid code improvement
and effective debugging.</b> Users/Co-developers are essential for the success of
a project. Linus' cleverest hack was not to build the Linux kernel itself, but the
invention of the Linux development model (Bazaar). One precedent for the methods and
success of Linux was seen in the GNU Emacs Lisp Library, developed in a collaborative
way, in contrast to the traditional cathedral style adopted for the GNU tools.

<b>Release early and release often</b>. The shared belief used to be that releasing
too early was at high risk of wearing out user's patience. But Linus' approach of
releasing very (VERY) often kept his users stimulated. The idea that, given a large
enough developers base, bugs will be fixed quickly worked well with Linux. Sociologies
have shown that the average opinion of a mass of equally expert observers is more reliable than
the opinion of a single randomly chosen observer (<b>Delphi effect</b>). In the case of Linux, this has
been proved true also for the development and debugging a piece of software so 
complex as an OS kernel. Debugging cost in terms of interactoin does not increase
with the square of the number of debuggers, sofware development does. According
to <b>Brook's Law</b>, adding more programmers to a late project makes it later due to
communication overhead. For debugging instead, many people running traces will be
more effective than few people running traces sequentially, even more experienced.



