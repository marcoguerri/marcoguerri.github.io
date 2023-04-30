---
layout: post
title:  "Reverse engineering MS-DOS binaries"
date:   2023-02-04 08:00:00
published: false
categories: reversing programming
pygments: true
---

I have been working on OptionROM malwares and used a Broacdom NIC as test
vector. `B57UDIAG.EXE` is the vendor tool which allows to configure and test
the hardware, including manipulating OptionROM.


Disassembling Linear Executables
=======
IDA 4.1 supports disassembling Linear Executable binaries under DOS. 
The idb produced can then be imported into IDA 5.0 under Windows.
There is still an IDA 5.0 binary available.

Alternatively, Ghidra also has a Linear Executable loader, but I have had a much harder time
using Ghidra as it is unable to "discover" all executable code. The decompiled code is also
inaccurate, as the assembly doesn't always make use of clear function prologue and epilogue.
Take for example the following code:

Stripping PMODE header
=======


Command line flags
=======
The OptionROM of the NIC is controlled with two commands:
* `B57UDIAG.EXE -c <ADAPTER> setpxe`
* `B57UDIAG.EXE -c <ADAPTER> pxe <OPTION_ROM_BINARY>`

The former enables support for OptionROMs, while the latter overwrites
the OptionROM region in NVRAM.


setpxe command
=======

We can first look for the occurrences of `setpxe` string in the binary.
We'll find two:

```
00235F67 aSetpxe         db 'setpxe',0           ; DATA XREF: sub_F23C5+150o
```

and
```
0020767E aSetpxe_0       db 'setpxe',0           ; DATA XREF: dseg02:off_25B266o
```

The second is the one of interest, which is also further referenced through its offset:

```
0025B266 off_25B266      dd offset aSetpxe_0     ; DATA XREF: cseg01:00031BC4o
0025B266                                         ; cseg01:00031BD9o ...
0025B266                                         ; "setpxe"
```

If we look for the references to `0x25B266` we'll see similar patterns repeating.
The first reference is the following:

{% highlight assembly linenos %}
00031BBD loc_31BBD:                              ; CODE XREF: cseg01:00031BA3j
00031BBD                 lea     ebx, [esp+4000h]
00031BC4                 mov     edx, offset offset_setpxe
00031BC9                 mov     eax, ebp
00031BCB                 call    sub_158A3
00031BD0                 test    eax, eax
00031BD2                 jnz     short loc_31BFF
00031BD4                 mov     edx, 73h
00031BD9                 mov     eax, offset offset_setpxe
00031BDE                 call    sub_152F3
00031BE3                 mov     edi, eax
00031BE5                 mov     edx, esi
00031BE7                 xor     eax, eax
00031BE9                 call    sub_86E31
00031BEE                 test    eax, eax
00031BF0                 jz      short loc_31C09
00031BF2                 push    offset aUnableToLoad_0 ; "Unable to load eeprom content\n"
{% endhighlight %}

The other references to `0x25B266` show a similar execution flow however with `0x65` and `0x64` in `edx`. 
These hex codes, `0x74`, `0x65` and `0x64` are the command line flags supported  by `setpxe`, so we should expect for this 
code to be dispatching `setpxe` execution based on the parameters provided. If we follow all `call` instructions, we'll see
functions starting with a common prologue, similar to the following:
```
000158A3                 push    <HEX_CODE>
000158A8                 call    sub_19576C
```

This is a stack overflow protection mechanism which is prepended to every function call. We can focus on the PXE enable 
control path, following therefore `0x65`:

{% highlight assembly linenos %}
00031C23                 mov     edx, 65h
00031C28                 mov     eax, offset offset_setpxe
00031C2D                 call    sub_1531D
00031C32                 test    eax, eax
00031C34                 jz      short loc_31C98
00031C36                 push    0
00031C38                 mov     ecx, 2
00031C3D                 mov     ebx, ecx
00031C3F                 mov     edx, esi
00031C41                 xor     eax, eax
00031C43                 call    sub_A1CA8
{% endhighlight %}

The result of the `sub_A1CA8` is then processed. The return code `A0` seems to indicated that PXE firmware
was not found in NVRAM:

{% highlight assembly linenos %}
00031C48                 mov     edx, eax
00031C4A                 test    eax, eax
00031C4C                 jz      loc_31DE6
00031C52                 cmp     eax, 0A0h
00031C57                 jnz     short loc_31C71
00031C59                 push    offset aPxeFirmwareCan ; "PXE firmware cannot be found in NVRAM. "...
00031C5E                 call    sub_16309
00031C63                 add     esp, 4
00031C66                 test    eax, eax
00031C68                 jnz     short loc_31C81
00031C6A                 mov     eax, edx
00031C6C                 jmp     retn_path
{% endhighlight %}

Line `7` is interesting, because as we have seen initially while looking into NVRAM dumps, when PXE is enabled, 
there is one byte flag which is set to `0x2`, while it's `0x0` when PXE is disabled. If we look at the control 
path for `0x64`, we can see a similar pattern:

{% highlight assembly linenos %}
00031C98                 mov     edx, 64h
00031C9D                 mov     eax, offset offset_setpxe
00031CA2                 call    sub_1531D
00031CA7                 test    eax, eax
00031CA9                 jz      short loc_31CE1
00031CAB                 push    1
00031CAD                 xor     ecx, ecx
00031CAF                 mov     ebx, 2
00031CB4
00031CB4 loc_31CB4:                              ; CODE XREF: cseg01:00031DCDj
00031CB4                 mov     edx, esi
00031CB6                 xor     eax, eax
00031CB8                 call    sub_A1CA8
00031CBD                 test    eax, eax
00031CBF                 jz      loc_31DE6
{% endhighlight %}

Here we have a `xor ecx, ecx` on line `7`, which will give us  the `0x0` value. In both cases, we call `sub_A1CA8`.
For `0x65`, after a sequence of checks, we end up with a `PXE firmware cannot be found in NVRAM. Program anyway? Y/N` message.
This is important because in the `0x65` control path, we see that depending on the result of `sub_16309` after the 
`Program anyway?` question, we might jump to `loc_31C81`:

```
00031C81 loc_31C81:                              ; CODE XREF: cseg01:00031C68j
00031C81                 push    1
00031C83                 mov     ecx, 2
00031C88                 mov     ebx, ecx
00031C8A                 mov     edx, esi
00031C8C                 xor     eax, eax
00031C8E                 call    sub_A1CA8
00031C93                 jmp     loc_31DE6
```

We can see the similar `mov ecx, 2` and call to `sub_A1CA8` which at this point we can assume to be a "programming" function
and we label it accordingly. Before moving ahead, it is worth having a look at `sub_16309`. This is supposedly a function
which prints a message on screen and waits for user input, e.g. `Y/N`. In fact, the full message in the listing above is
`PXE firmware cannot be found in NVRAM. Program anyway? Y/N`. The code makes use of two different types of output:

* Text I/O, implemented by writing directly to video memory buffers
* Graphical I/O , implemented by writing into memory of video adapter at `B8000`

The interactive messages make all use of the second mode. Following the code which renders colored output to video memory
is not straightforward, and `dosbox` emulator becomes incredibly useful. The execution under `dosbox` fails becuse not adapter
is found, and the error messages is printed with the same Graphical I/O approach. In the executions represented in the following
screenshot, 32 bit program code seems to be pointed by segment selector `0868`, while there seems to be a [TODO] offset between
`IP` and linear address of the linear executable disassembled by IDA. This is useful to be able to set breakpoints in the correct
place. The code which implements Graphical I/O begines with loading `B8000` address:

```
00016122                 mov     eax, offset dword_258F24
00016127                 call    sub_16090
```

At `0x258F24` one can see the initialization value is set to `0x0B8000`. `eax` can be considered a double pointer in this case.

The actual write to video memory happen happens in the function in `0x15B88`:

```
00015BA9 loc_15BA9:     ; CODE XREF: write_b8000_through_ec+Ej
00015BA9                 mov     ecx, [eax+4]
00015BAC                 test    ecx, ecx
00015BAE                 jz      short loc_15BBB
00015BB0                 mov     [ecx], dl
00015BB2                 mov     ecx, [eax+4]
00015BB5                 mov     dl, [eax+1Ch]
00015BB8                 mov     [ecx+1], dl
```

The state of the execution is very clear from the `dosbox` screenshot below. `ECX` holds the pointer to video memory, while
`EDX` holds the value to be written and `mov [ecx], dl` implements the actual write.

<p align="center">
<a id="single_image" href="/img/dos/dosbox_1.png">
<img src="/img/dos/dosbox_1.png" alt=""/></a>
</p>


We can even double check that at `B833A` or any address close by are actually backing video memory. 
`dosbox` command `sm 0868:<OFFSET> 0x0` will write a null 16 bits at that address. That becomes clearly visible from the output

<p align="center">
<a id="single_image" href="/img/dos/dosbox_2.png">
<img src="/img/dos/dosbox_2.png" alt=""/></a>
</p>

The text mode output is slightly simpler, but there is immediately something interesting to be noticed. We can land immediately
on the PXE programming path:

```
0002A952                 push    offset aUpdatingDire_0 ; "Updating Directory...\n"
0002A957                 call    <TEXT_IO_FUNCTION>
0002A95C                 add     esp, 4
0002A95F                 mov     edx, [esp+164h+var_30]
0002A966                 push    edx
0002A967                 push    offset aCode_lenImage0 ; "code_len image     = %08x\n"
0002A96C                 call    <TEXT_IO_FUNCTION>
```

Following that control path, there first and foremost a setup function for monochrome video memory:

```
001AC0EE                 mov     eax, [ebp+var_4]
001AC0F1                 mov     dword_2A0909, 400h
001AC0FB                 mov     dword_2A090D, (offset loc_AFFFF+1)
001AC105                 mov     dword_002A0911, 0B8000h
001AC10F                 mov     dword_002A0915, offset loc_A0000
001AC119                 mov     dword_2A0919, (offset loc_BFFFC+4)
```

Which are then later used to perform the actual I/O:

```
001ACDFC loc_1ACDFC:                             ; CODE XREF: write_to_monochrome_address+20j
001ACDFC                 mov     eax, dword_002A0915
001ACE01                 mov     di, word_2A0903
```

And further down:

```
001ACE4B                 add     edx, esi
001ACE4D                 mov     es:[eax], dx
```

[There are however debug messages]

TODO: check if indeed the default file handler is being used: https://stanislavs.org/helppc/file_handles.html 
