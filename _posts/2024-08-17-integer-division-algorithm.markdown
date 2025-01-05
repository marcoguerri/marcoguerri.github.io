---
layout: post
title:  "Calculating remainder without division operations"
date:   2024-08-17 08:00:00
published: false
pygments: true
toc: true
tags: [algorithms, arithmetic]
categories: [Technical]
---


Latex attempt
=======

Assume we have a signed value $n$ that we want to divide by $d$:

<p style="font-size: 1em" align=center>
$ \begin{equation} \frac{n}{d} \end{equation} $
</p>

We represent either with $W$ bits. One bit must be allocated to the sign,
so the maximum positive value of must be:

<p align=center>
$ \begin{equation}  2^{W-1}-1 \end{equation} $
</p>

We also contrain $d$ to be $> 1$. The relationship between $n$, $d$, quotient $q$
and reminder $r$ can be defined as follows:

$ \begin{equation} n = q \cdot d + r  \end{equation} $

Note that $r$ must be postive, regardless of the value of $d$ and $n$.
We want to find a way to calculate $q$ and $r$ efficiently, expressing the former through multiplication and division 
operations and calculating the latter as a consequence. $q$ is the result of the integer division. Both for positive and negative values of $n$, it can be expressed as

$
\begin{equation} q = \left\lfloor \dfrac{n}{d} \right\rfloor \end{equation}
$

For $n>0$, `floor` operation truncates the fractional part, so the equivalence is
intuitive. For $n<0$, `floor` operation also rounds towards negative infinity, 
so the equivalence is coherent with the constraint $r>0$. We need to define a 
relationship between the computationally efficient operation mentioned previously
and $q$. We know we want to rely on multiplication and bit shift, so the former
can be expressed as follows:

<p align=center>
$ \dfrac{m \cdot n}{2^{p}} $
</p>

where dividing by $2^{p}$ means shifting right by $p$ positions. Both with positive and negative $n$, 
shifting right will round towards negative infinity (this can be demonstrated) which is equivalent
to the following floor representation:

<p align=center>
$\left\lfloor \dfrac{m \cdot n}{2^{p}} \right\rfloor$
</p>

We could conclude we want to identify $m$ and $p$ such that

\begin{equation}
\label{main_relationship}
\left\lfloor \dfrac{m \cdot n}{2^{p}} \right\rfloor = 
\left\lfloor \dfrac{n}{d} \right\rfloor
\end{equation}

# Equivalence for positive n

From $\ref{main_relationship}$ one can derive that 

$\begin{equation}m = \frac{2^{p}}{d}\end{equation}$

However, $m$ must be an integer, in particular

$\begin{equation} \label{m_solution_ge} m \ge \frac{2^{p}}{d}\end{equation}$

so that the left hand side of $\ref{main_relationship}$ rounded to the lower integer 
still satisfies the equivalence.

# Equivalence for negative n

If we consider $\ref{main_relationship}$ and the solution

$\begin{equation} \label{m_solution} m = \frac{2^{p}}{d}\end{equation}$

for $n < 0$, we can intuitively see that picking an integer value $ > \ref{m_solution}$,
might result in the floor operation rounding to the lower integer, breaking the equivalence.
Assuming for example $d = 15$ and  $n = -d$, we need for $m$ to be an integer such that:

\begin{equation}
\label{value_m_negative_n}
m = \frac{2^{p}}{15}
\end{equation}

$\ref{value_m_negative_n}$  cannot be an integer, so we need to pick the closest greater integer.
However, with that value we would round the left hand side of $\ref{main_relationship}$ to the 
lower integer and invalidate the equivalence. We need therefore to formulate $\ref{main_relationship}$
differently for $n<0$, in particular as follows:

$
\begin{equation}
\left\lfloor \dfrac{m \cdot n}{2^{p}} \right\rfloor + 1 = 
\left\lceil \dfrac{n}{d} \right\rceil
\end{equation}
$

Testing again the case for $n= -d$ would result in

$
\begin{equation}
\label{equivalence_n_minus_d}
\left\lfloor \dfrac{m \cdot n}{2^{p}} \right\rfloor + 1 = 
-1
\end{equation}
$

If solution  $\ref{m_solution}$ was an integer, it would not satisfy \ref{equivalence_n_minus_d} as
we would have

$\begin{equation} -1 +1 = -1\end{equation}$

Therefore, we need to add an additional constraints to $\ref{m_solution}$ and consider strictly

$\begin{equation} \label{m_final_solution} m > \frac{2^{p}}{d}\end{equation}$

Note that to obtain $q$, we will need to subtract -1 from the result of the computationally
efficient operation.

# System of equivalances

We summarize the constraints for $n \ge 0$ and $n < 0$ with the following system of equivalances

$
\begin{numcases}{}
\label{nd_first_condition}
\left\lfloor \dfrac{m \cdot n}{2^{p}} \right\rfloor = 
\left\lfloor \dfrac{n}{d} \right\rfloor
  & 
\text{if } 0 \leq n < 2^{W-1}\\\\[20pt]
\label{nd_second_condition}
\left\lfloor \dfrac{m \cdot n}{2^{p}} \right\rfloor + 1 = 
\left\lceil \dfrac{n}{d} \right\rceil &
\text{if } -2^{W-1} \leq n \leq -1 \\\\[20pt]
\end{numcases}
$

We want for the followig to be met:
$\begin{equation} 0 \leq m \lt 2^{W} \end{equation}$

So that we can still represent $m \cdot n$ with two times the word size.

And
$ \begin{equation} p \geq W \end{equation}$

So that $2^{p}$ becomes a right shift that extracts the left half of the product $m \cdot n$.
In the previous sections we have found a lower bound for $m$. To get an upper bound for $m$, we
need to consider an $n$ which would result in the largest fractional value of $n$ over $d$. With
the largest fractional value, we can get the exact definition of the largest $m$ that would still
hold the equivalence in $\ref{nd_first_condition}$. This value of $n$ is $n_c$ such that

$\begin{equation} \label{nc_condition} n_c \bmod d = d-1 \end{equation}$

We know that $n_c$ exists, because at least 

$\begin{equation} \label{min_nc} n_c = d-1 \end{equation}$ 

satisfies $\ref{nc_condition}$. Since the largest possible value of $n$ is $2^{W-1}-1$, 
if the following condition was satisfied

<p align=center>
$(2^{W-1} -1) \bmod d= d-1$  
</p>

we would already have our $n_c$. However, we want to find a lower bound for $n_c$,
i.e. the minimum value of $n$ that defines the range for any possible $n_c$ that meets 
$\ref{nc_condition}$ across all possible values of $d$ and $W$.
Assume

<p align=center>
$  (2^{W-1}-1) \bmod d = d$
</p>

then 
<p align=center>
$  (2^{W-1}-2) \bmod d = d-1$
</p>

which could meet $\ref{nc_condition}$. The worst case scenario, i.e. the lowest value of $n$
is however when we need to subtract the largest quantity from $2^{W-1}-1$ to meet 
$\ref{nc_condition}$. If

<p align=center>
$ (2^{W-1}-1)  \bmod d = d-2$
</p>

we derive that $(2^{W-1}-1)-d+2$ would be divisible by $d$ and therefore $(2^{W-1}-1)-d+2-1 \bmod d = d-1$ 
which would satify $\ref{nc_condition}$ and define our lower bound as $2^{W-1}-d$. We would then get

$\begin{equation} 2^{W-1} -d \leq n_c \leq 2^{W-1} -1\end{equation}$


Also

$\begin{equation}n_c \geq d-1\end{equation}$

due to $\ref{min_nc}$. Because $\ref{nd_first_condition}$
must hold for $ n = n_c$, we can derive


$\begin{equation} \left\lfloor \frac{m \cdot n_c}{2^{p}} \right\rfloor = \left\lfloor \frac{n_c}{d} \right\rfloor
\end{equation}$


However, since 

$\begin{equation}n_c \bmod d = d-1\end{equation}$

we have that $n_c - (d-1)$ will be
divisible by $d$ and equal to $\frac{n_c}{d}$ rounded to
the lower integer, i.e.


$\begin{equation} \left\lfloor \frac{n_c}{d} 
\right\rfloor = \frac{n_c-(d-1)}{d} \end{equation}$

Extracting $d$ from the right hand side yields the
following:

$\begin{equation} \left\lfloor \frac{m \cdot n_c}{2^{p}} 
\right\rfloor = \left\lfloor \frac{n_c}{d} \right\rfloor 
= \frac{n_c+1}{d} -1 \end{equation}$


If we remove $-1$ from the right hand side of the
equivalence, we get an upper bound for 
$\frac{m \cdot n_c}{2^{p}}$ 

or 


$\begin{equation}m < \frac{2^{p}}{d}\cdot\frac{n_c + 1}{n_c}\end{equation}$

Combined with $\ref{m_final_solution}$, we obtain


$\begin{equation} \frac{2^{p}}{d} < m < \frac{2^{p}}{d}\cdot\frac{n_c + 1}{n_c}\end{equation}$

https://stackoverflow.com/questions/8021772/assembly-language-how-to-do-modulo
