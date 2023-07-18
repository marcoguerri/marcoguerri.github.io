---
layout: post
title:  "Reverse engineering MS-DOS binaries"
date:   2023-02-04 08:00:00
published: false
categories: reversing msdos
pygments: true
---

I have collected some notes on how to reverse engineer old MS-DOS binaries while
building custom tooling to write Broadcom OptionROM on <XYZ>. The pecularity of MS-DOS
applications is that they sometimes make use of very outdated wrappers and formats, which
modern tooling doesn't always support. For the Broadcom tool, I have used in particular upx, <pmod header tol> , IDA 3.1, IDA 4.0.

The architecture of the tool
=======

Disassembling LE binaries
=======
IDA 4.1 supports disassembling Linear Executable binaries under DOS. 
The idb produced can then be imported into IDA 5.0 under Windows.
Both versions of the tool are still available at the time of writing:


Alternatively, Ghidra also has a Linear Executable loader, but I have had a much harder time
using Ghidra to discover all executable code. The disassembled code is also sometimes
inaccurate, as the tool doesn't always make use of clear function prologue and epilogue.
[elaborate]

Stripping PMODE header
=======

