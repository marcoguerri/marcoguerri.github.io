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


<b> Good programmers known what to write, great ones know what to rewrite and
reuse.</b>Sharing source code allows other programmers to use your code base to
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
too early was at high risk of wearing out user's patience, generating bugs that
grow excessively in complexity. However, Linus belief was that <b>given a large
enough developers base, any bug would be fixed quickly.</b> And this worked very well.
Sociologists have shown that the average opinion of a mass of equally expert observers is more reliable than
the opinion of a single randomly chosen observer. This is often referred to as the 
<b>Delphi effect</b>. In the case of Linux, it has been proved true also for the 
development and debugging a piece of software so complex as an OS kernel. 

Debugging cost in terms of interaction does not increase
with the square of the number of debuggers, software development does. However,
this assumes that all developers interact with each other, which is not true with
Open Source development. According to <b>Brook's Law</b> (add to reading list: The Mythical Man-Month), 
adding more programmers to a late project makes it later due to communication overhead. For debugging 
instead, many people running traces will be more effective than few people running 
traces sequentially, even more experienced.

Code should be as simple as possible. "Right" code is code which gets better
and simpler. From Antoine de Saint-Exupéry: <b>perfection is achieved not when there is nothing 
more to add, but rather when there is nothing more to take away.</b>

Starting projects in bazaar mode is very difficult, however it becomes easier to
improve. It is not critical that the coordinator be able to originate brilliant designs,
but he/she must recognize good design ideas from others. The open source community
internal market in reputation exerts pressure on people not to launch development
efforts they are not competent to follow through on. <b>Good people and communication
skills are essentials for coordinators of bazaar mode projects.</b>

If Brooke's law were the whole picture, the Linux would be impossible. Open source
does overturn this law. A vital
correction consists in <b>egoless programming</b> (add to reading list: The Psychology of
Computer Programming). When developers encourage other people to look at their code
and fix bugs, improvement is much faster and Brooke's law is heavily mitigated.
Cheap Internet was a necessary condition for the Linux model to evolve. This,
however, was not enough. Equally important was the development of a leadership 
model not based on coercion but on cooperation: <b>the severe effort of many
converging skills</b> is what projects like Linux requires.  

The "utility function" Linux hackers are maximizing is their own ego satisfaction
and reputation. Linus has funnelled the selfishness of hackers into the achievement
of a common goal. It would be expected by such a culture to be fragmented,
territorial and hostile. It is not the case for the Linux community (a clear proof
is the sheer amount of documentation produced.

Closed source world cannot win an evolutionary arm race with Open Source communities
that can put order of magnitude more skilled time into a problem. A common
critic is that the bazaar mode community is lacking the productivity-multiplying effect
of traditional management. But what is the management overhead buying?
  
  * Meeting deadlines?
  * Meeting budget?
  * Meeting features?
  * Legal liability

The truth is that rarely even one is achieved/guaranteed. Traditional development
management is a necessary compensation for poorly motivated programmers. Some
believe Open Source has been successful because it accept the most talented 5%.
The position towards commercial software varies with two degrees of freedom:
zealotry and hostility. Historically, the attitude has been very zealous and very
anticommercial (Stallman). Unix has been more market friendly, more pragmatist,
hating the refusal to incorporate open source tools (identified with the BSD
Unix licence). The <b>Debian Free Software guidelines</b> became in 1997 the 
Open Source definition.
\\
In the Open Source world, forks are considered a waste of resources and require
much public self-justification. The owner of an Open Source project is the one
who has the right to distribute a modified version and the one who applies
official patches (non official patches are referred to as rogue). There are
three  ways to acquire ownership of an Open Source project:

 * Founding it
 * Project handed over by the owner
 * Owner has lost interest and disappeared

This theory of ownership is very similar to <b>John Locke</b>'s rationalization of the
Anglo-American common law theory of land tenure which applies when the expected return
from the resource exceeds the expected cost of defending it. What are the possible
yields in the Open Source world?

 * Simply use of the project is not really enough as expected return. However,
 open source licenses imply a context where use is the only yield (and there 
 is no taboo against forking).
 * Seeking power again does not apply in the context of Open Source, where there is
  no scarcity economy and therefore no pursuing of material wealth.
 * <b>Reputation</b> instead, is central to the hacker culture (eventually reputation 
 can also have a return in terms of wealth in the real world). 
 
Societies can be split into the following categories:

 * those organized according to a hierarchy of command
 * those where social status is given by control of goods (<b>exchange economies</b>)
 * those where social status given by what you give away (<b>gift cultures</b>) 
 in the absence of scarcity


The society of opensource hackers is a gift culture. There is no shortage of hardware
resources (storage, compute power) and software is freely shared. The Lockean
property customs used within hackers are aimed at maximizing reputation incentives,
making sure that credit goes to the right individuals.

<b>Open source world is a post-scarcity gift culture where the expected return
in Lockean terms is the maximization of reputation.</b>

Hacker culture <b>distrusts ego-based motivation</b> and despises egotism. It's 
important that the role of prestige and ego remains unadmitted. In fact, self-promotion
would generate noise that would corrupt productivity. Instead, code must 
speak for itself, and the taboo towards ego-driven posturing is kept alive by
valuing humility. 

These customs become evident in several ways:

 * Technical competence is never attacked publicly. <b>Criticism is always 
   project labelled</b>.
 * Hackers flame each other over ideological issues but do not attack technical 
 competence.

The reputation-game model encourages founding <b>new and innovative projects</b>.
Homesteading the noosphere refers to the tendency to found <b>new and innovative projects</b>
rather than cloning projects that are recognized as category killers, because it would
be too hard to gain attention. The following are the main patterns according 
to which hacker culture values 
contribution:

  * It was to work as well as I have been led to expect it will
  * Extending is better than duplicating
  * Work that makes it into major distribution is better then work that does not
  * Work used by lot of people is better than work used by few
  * Continued devotion to hard, boring work is more pairseworthy then cherrypicking
  the fun and easy hacks
  * Nontrivial extensions of function are better then low-level patches and debugging

When it comes to conflicts, the following rules apply (considering the model
of a <b>benevolent dictator</b>)

  * Project owner makes binding decisions
  * Project owner is obliged to credit contributors fairly
  * Subsystem owner controls implementation and interface, subject only to
  correction by project leader

There exist other models, for example the <b>voting committee</b> model which runs
the Apache project. In general, <b>authority follows responsibility</b>.

The reputation-game gift culture is the best social organization for what the
community is trying to do. This is supported by several psychology studies which
report that <b>commissioned work is less creative than work done out of interest</b>,
complex activities are hurt by rewards and flat salaries do not demotivate, but
rather bonuses do (reference: psychologist Theresa Aambile of
Brandeis University, 1984). The best course of action is to decouple salary from 
performance in programming and let people choose their projects. When creativity 
is needed, a group of open source developers is more productive
than a group of closed source developers motivated by rewards in a scarcity
context.

The gift-culture explanation does not fully address those mixed economic contexts 
in which most open source projects operate. Goods either have <b>use value or sell value</b>.
When it comes to software, the former is the value of a software as a tool to boost
productivity, the latter is the value as a salable commodity. Most people assume
software-production economies follow a "factory model", where the sale value of
the software is proportional to the time it took to develop. This is usually false.
First, most of programming jobs are founded by use value.
<b>The sale value of a software is not proportional to its development cost.</b>
The price is capped by the expected future value of vendor services (enhancements,
upgrades, etc.). If the vendor goes out of business, nobody is willing to pay anything
anymore for that software. <b> Software industry is therefore a service industry,
not a manufacturing one</b>. When considering software a manufacturing product,
supporting life cycle's cost with sales works only if the market is expanding quickly
enough. One way to sustain the life cycle of a software is to release bug fixes
as new products, but this does not work in the long run from the customer's
perspective. Vendor lock-in is most of the times the only way to implement
a sustainable life cycle of a software as a manufacturing product. The alternative
to the factory model is a price structure based on service contracts and subscriptions,
and this is there direction preferred by Open Source.

Cooperative behaviour, and Open Source in this case, is always subject to the risk
referred to as <b>"The Tragedy of the Commons"</b> (first defined by Garrett Hardin), 
a situation where a resource held
in common is overused and no further provisioning is encouraged (the latter being
referred to as the free-rider behavior). Three are the  possible outcomes of 
this "tragedy of the commons":
    
   * Resource is exhausted 
   * A higher coercive power enforces allocation policy, as it happens in a
   communist context
   * Break-up of the resource and assigning property

However, this theory does not apply to software, which is in this case the public good.
<b>Software's value does not decreases with overuse, rather it increases.</b>
The problem of the free-rider behavior does not exist either. In fact, 
<b>solutions are needed on time</b>, therefore people are more inclined to
to do the work they need themselves rather then waiting for others to do the
work. Furthermore,  when a patch is created, it is more valuable if submitted 
upstream. Maintaining a rogue patch becomes more difficult than merging it. Even
if we could admit the existence of a free-rider behavior, then this would not
get worse with the number of the users, the development community is not negatively
affected by end users who do not contribute. 


The reasons for software begin closed source is either preserving its sell value
or denying its use to competitors. The argument against revealing confidential 
aspects of the business plan applies only if the code is badly designed: the 
business logic and knowledge should be separated from the engine. In addition, 
it must be assessed whether the benefits from the contribution of the community 
exceed the potential losses from the free-riders' competition. In case of Apache, 
the use value alone funds the development of the project: in fact, the project 
has no legal owner and market shares have been steadily increasing. 


Open source community adopts a non-hostile attitude towards for-profit Linux 
packagers like RedHat or SuSe. However, hostility is indeed felt against 
<b>direct-revenue-capture licenses</b> for mostly three reasons:

  * Symmetry: no party should be in a privileged position to extract profits 
  * Restrictions on use/sale/modification/distribution causes overhead and legal risks
  * It makes it impossible to fork, which is frowned upon, but must be possible

Open Source fosters <b>indirect sale value models</b>:

  * <b>Loss leader and market positioner</b>: open source used to develop a product 
  that allows to maintain a market position with a complementary proprietary software.
  One major example is Netscape Communicator, open sourced in 1998 to face Microsoft
  quick acquisition of market shares after shipping Internet Explorer.

  * <b>Widget Frosting</b>: this applies to hardware manufacturer. Software written
  for hardware, like drivers, is overhead. This is an excellent situation where
  to open source.
  
  * <b>Give away the recipe, open a restaurant </b>: this model is based on 
  selling support and certifications. It's the model used by Red Hat for example.

  <b>Accessorizing</b>: revenues comes from the sale of accessories, from T-shirts,
  mugs to documentation. This is the model adopted by O'Reilly.

  <b>Free the future, sell the present</b>: sell binary and sources with a closed
  license, but with an expiration date on the closure provision.

  <b>Free the software, sell the brand</b>: sell the compliance certification by
  retaining compatibility criteria and test suite.
  
  <b>Free the software, sell the content</b>: sell subscriptions to the content.
  The market expands as the software is ported to new platforms.
  
  
One of the lessons coming from Linux's evolution is that peer review is the only
way for achieving high reliability and high quality. Secrecy is enemy of quality,
as it's more lucrative to collect the rent than to invest in improving the product.
Open-sourcing a software product makes sense in the following cases:

  * Reliability and scalability is required and correctness can only be verified
  by peer review
  * The software is critical for running a business
  * When it is necessary to establish a computing and communication infrastructure
  * Key methods are part of  common engineering knowledge
  
On the contrary, open source does not make sense for companies that have unique
possession of of value-generating software technology. An interesting case study
is Doom. At the beginning, it was very innovative and it didn't make sense for
id Software to open source it. When it started losing market shares, specifications
on how to created add-ons were released. This parallel market became bigger then the 
primary one and Doom was open sourced.


Sometimes Open Source also works as a strategic move against a company's 
competition:

  * <b>Cost-sharing as a competitive weapon</b>: lowering cost by sharing for
  example the infrastructure allows to gain a market position that reassures
  customers
  * <b>Resetting the competition</b>: open sourcing and creating a new de-facto
  standard neutralizes the advantage of other companies
  * <b> Growing the Pond</b>: the growth of the ecosystem builds the market. This
  is the reason why technology firms participate in public standards
  * <b>Preventing a chokehold</b>: it often more important to prevent a competitor
  from closing a technology rather then controlling it


When imagining Linux's future, a necessary question is: will it fragment? 
With Linux it won't be possible for Unix's history to repeat, as the license of
the base of source code requires vendors to share modifications to all the parties
to whom the software is distributed (GPL does allow to modify and not share 
neither the modified version nor the sources). The only area in which vendors
can compete is service and support.

Some worry that the market value of software will go to zero because of all the 
free source code out there and at some point use value will not attract enough 
consumers. This does not make sense, because the world is evolving very fast and 
there will always be demand for software.

Hardware manufacturers may fear that open sourcing may reveal important aspects
about how the hardware operates that competitors could copy. But the time
competitors spend in understanding a design is time they don't dedicate
to their own product, and by the time a copy is ready, it's already obsolete.
By opening a driver you can focus on investing in innovation and let the
community maintain, improve and port the code. This will also allow to continue
support the hardware once it is discontinued. An intermediate way is to burn
some code in a ROM and to open the interface to the ROM. 

At the time of dispute between Netscape Navigator and Internet Explorer,
the only Netscape's concern was to maintain a space for their server business.
Microsoft would have bent Web's protocols away from open standards into proprietary
channels that only Microsoft servers would be able to serve. Raymond's "The 
Cathedral and the Bazaar" deeply affected Netscape's decision to open source
their browser. The Mozilla project and the Mozilla public library were developed
specifically for this case. Also, the term "Open Source" was created in 1998
as part of a marketing campaign to promote Netscape browser. After
Bruce Perens' suggestion, Debian's Free Software Guidelines became the Open Source
definition. When the coverage of the media increased, it became clear that
big companies started to be worried about the phenomenon (Halloween's documents).


Beyond software, there are not as strong incentives to open source. Music
and books don't need to be debugged, maintained and do not benefit from peer
reviewing.

  
  

