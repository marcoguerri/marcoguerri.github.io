---
layout: post
title:  "Reverse engineering MS-DOS binaries"
date:   2023-02-04 08:00:00
published: false
categories: reversing msdos
pygments: true
---

I have been working on OptionROM malware development using a Broacdom BCM5751 1G Network Card on 
a PCEngines APU2D board. `B57UDIAG.EXE` is the vendor tool whichconfigures and tests Broadcom NICs, 
including all PXE related information (OptionROM binary, PXE enablement/disablement, etc.) The tool however runs only on MS-DOS. In order to iterate
faster during OptionROM development,  I was looking for a way to manipulate correctly the NVRAM of the NIC,
which is accessible from `ethtool`, from Linux. I derived layout specification, algorithms for integrity checks
and other information by reverse engineering specific control paths of the `B57UDIAG.EXE` tool. 

It must be noted that several results obtained here could have probably been sourced from the existing 
end to end reverse engineering effort that produced the [ortega specification](https://github.com/hlandau/ortega).
Nevertheless, I did want to go through a reverse engineering exercise of a MS-DOS tool and this was
a perfect opportunity, so I essentially ignored any resource that did not include:
* Datasheet
* `B57UDIAG.EXE` code


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

Reversing PXE commands
=======
Broadcom tool exposes primarily two commands to manipule PXE OptionROM:
* `B57UDIAG.EXE -c <ADAPTER> pxe <OPTION_ROM_BINARY>`
* `B57UDIAG.EXE -c <ADAPTER> setpxe <FILE>`

There are more, for example to change the adapter PXE speed. This note will focus only on the two
above. `pxe` enables support for booting PXE payloads off the NIC NVRAM, while `setpxe` overwrites 
the OptionROM binary. It is useful to dump the content of NVRAM before and after the invocation of 
both commands, to get an idea of which area of memory are manipulated. `ethtool` can do this with
`raw on` flags:
```
ethtool raw on
```

Running `pxe` command generates the the following binary differences:

<p align="center">
<a id="single_image" href="/img/dos/NVRAM_differences.png">
<img src="/img/dos/NVRAM_differences.png" alt=""/></a>
</p>

Overall, three changes stand out, within the first 512 bytes of NVRAM. Further below, we can see the
whole OptionROM binary blob.


Running `setpxe` command instead results in the following binary differences:



Dispatching command line flags
=======
Looking for occurrences of `setpxe` string gets us to the code which dispatches command line arguments.
We can find two occurrences of `setpxe`:
```
00235F67 aSetpxe         db 'setpxe',0           ; DATA XREF: sub_F23C5+150o
```
and
```
0020767E aSetpxe_0       db 'setpxe',0           ; DATA XREF: dseg02:off_25B266o
```

The latter is the one of interest, which is also further addressed through its offset:

```
0025B266 off_25B266      dd offset aSetpxe_0     ; DATA XREF: cseg01:00031BC4o
0025B266                                         ; cseg01:00031BD9o ...
0025B266                                         ; "setpxe"
```

If we look for the references to `0x25B266` we'll see similar patterns repeating:

{% highlight asm %}
00031C23 loc_31C23:                              ; CODE XREF: cseg01:00031C1A␘j
00031C23                 mov     edx, 65h
00031C28                 mov     eax, offset offset_setpxe
00031C2D                 call    sub_1531D
{% endhighlight %}

The only difference across several references to `0x25B266` are the hex values stored in `edx`. 
In addition to `0x65`, we also see `0x64` or `0x73`, which are command line flags `-e`, `-d`, `-s`. 
The parsing happens in multiple stages. We dereference first the content of `[eax+8]`, i.e. 
`offset offset_setpxe + 8`, checking that it is not 0:
```
0001531D sub_1531D       proc near               ; CODE XREF: cseg01:0001C717␙p
0001531D                                         ; sub_2F945+53␙p ...
0001531D                 push    4
00015322                 call    stack_overflow_outer_outer
00015327                 mov     eax, [eax+8]
0001532A                 test    eax, eax
0001532C                 jz      short loc_15346
```

We then start a loop where we compare `edx` with `[eax]` and in case they don't match, we increase
`eax` by `0x14h` and repeat. If we look through content of the data segment referenced in this code, 
we'll see that `0x64`, `0x65`, `0x73` are stored at `0x14` increments starting from `[eax]`. 

```
0001532E loc_1532E:                              ; CODE XREF: sub_1531D+27␙j
0001532E                 mov     dh, [eax]
00015330                 test    dh, dh
00015332                 jz      short loc_15346
00015334                 cmp     dl, dh
00015336                 jnz     short loc_15341
00015338                 mov     al, [eax+10h]
0001533B                 and     eax, 0FFh
00015340                 retn
00015341 ; ---------------------------------------------------------------------------
00015341
00015341 loc_15341:                              ; CODE XREF: sub_1531D+19␘j
00015341                 add     eax, 14h
00015344                 jmp     short loc_1532E
00015346 ; ---------------------------------------------------------------------------
00015346
00015346 loc_15346:                              ; CODE XREF: sub_1531D+F␘j
00015346                                         ; sub_1531D+15␘j
00015346                 xor     eax, eax
00015348                 retn
00015348 sub_1531D       endp
```

We are essentially trying to match the proper area of memory with command line flag of interest, 
returning `[eax+10h]`, when we get a match. This latter address stores the value of the command 
line flag. Based on the return value, the caller will decide how to dispatch further calls to
honor the input parameters.


Stack protection
======
If we follow all `call` instructions, we see functions starting with a common prologue, similar to the following:
```
000158A3                 push    <HEX_CODE>
000158A8                 call    sub_19576C
```

This is a stack overflow protection mechanism which is prepended to every function call. 


Debug messages
=====
Before moving ahead, it is worth having a look at `sub_16309`. This is supposedly a function
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

TODO: why logs are revelant

NVRAM I/O
=======


Programming function
=======

There main function responsible for altering the content of NVRAM is `sub_8708A`, where we can see a known refernce
to `eecfg_write` verbose log output:

```
eecfg_write
```

Foundamentally, `sub_8708A` ends up calling NVRAM write and read commands as outlined in the previous section.


setpxe command
=======
`setpxe` command is relatively straightforward. After interpreting command line flags, we dispatch a programming request
to `sub_A1CA8`. On the PXE enable control path, we can see the following invocation

```
00031C36                 push    0
00031C38                 mov     ecx, 2
00031C3D                 mov     ebx, ecx
00031C3F                 mov     edx, esi
00031C41                 xor     eax, eax
00031C43                 call    program_nvram
```

while on the PXE disable control path, we have

```
00031CAB                 push    1
00031CAD                 xor     ecx, ecx
00031CAF                 mov     ebx, 2
00031CB4
00031CB4 loc_31CB4:                              ; CODE XREF: cseg01:00031DCD␙j
00031CB4                 mov     edx, esi
00031CB6                 xor     eax, eax
00031CB8                 call    program_nvra
```

The two main differences that stand out are the first stack argument, 0 or 1 and the value in `ecx`, 2 and 0.

pxe command
=======


Updating directory
=======
The low address range of the NVRAM stores a table of metadata which is referred to as
"directory". The function at `0x2BB4D` goes through this table to find an entry suitable
for storing PXE blob metadata. Every entry is identified with an id and the base directory holds
8 entries at most. There exists also the concept of extended  directory, but we will not cover 
it in this exercise. The code iterates through entries `[0,8[` and under certain conditions, it 
copies their content to memory. `ecx` is used store the current index and address NVRAM as follows:
```
0002BBA9 loc_2BBA9:                              ; CODE XREF: dir_find_entry+50j
0002BBA9                 mov     eax, ecx
0002BBAB                 shl     eax, 2
0002BBAE                 sub     eax, ecx
0002BBB0                 shl     eax, 2
0002BBB3                 add     eax, edi
```
This code already reveals important information on how the directory is structured. In fact, starting
from an index, NVRAM is addressed as `(((4*index-index)*4)+<BASE>)+<OFFSET>`, i.e. 
`12*index+<BASE>+<OFFSET>`, suggesting that every item in the table is 12 bytes long.

We first fetch 4 bytes content at +4 offset and reverse its endianess,  using `esp+1Ch+var_14` as temporary storage.
<details> <summary>Expand code</summary>
{% highlight asm %}
0002BBB5                 mov     edx, [eax+4]
0002BBB8                 and     edx, 0FF000000h
0002BBBE                 shr     edx, 18h
0002BBC1                 mov     [esp+1Ch+var_14], edx
0002BBC5                 mov     edx, [eax+4]
0002BBC8                 and     edx, 0FF0000h
0002BBCE                 shr     edx, 8
0002BBD1                 mov     ebx, [esp+1Ch+var_14]
0002BBD5                 or      ebx, edx
0002BBD7                 mov     edx, [eax+4]
0002BBDA                 and     edx, 0FF00h
0002BBE0                 shl     edx, 8
0002BBE3                 or      ebx, edx
0002BBE5                 mov     edx, [eax+4]
0002BBE8                 and     edx, 0FFh
0002BBEE                 shl     edx, 18h
0002BBF1                 or      edx, ebx
{% endhighlight %}
</details>
<br>
We then skip skip the entry in the following cases:
* Its value is `0x3FFFFF`
* Value of bits `[24,31]` is != 0x10

```
0002BBF3                 test    edx, offset unk_3FFFFF
0002BBF9                 jz      short loc_2BB9F
0002BBFB                 shr     edx, 18h
0002BBFE                 and     edx, 0FFh
0002BC04                 cmp     edx, 10h
0002BC07                 jnz     short loc_2BB9F
```

Bits `[24,31]` have a have a special meaning, which we'll see later. If the entry passes all checks above, 
we copy the content at `+8` into `ebp` and call `0x000B19EA`:
```
0002BC3E                 lea     edx, [edi+60h]
0002BC41                 mov     ebx, 30h
0002BC46                 mov     eax, ebp
0002BC48                 call    sub_B19EA
```
Through `sub_B19EA`, we ask to fetch NVRAM data from offset `ebp`, which we just read at `<DIRECTORY_ENTRY>+8` 
for a lenght of 0x30\*4 into destination address in `edx`. We derive the meaning of these parameters by 
following `sub_B19EA` and seeing that it increments the source and destination addresses by 4 until we 
reach the desired lenght:
```
000B19F7                 mov     esi, eax
000B19F9                 mov     ecx, edx
000B19FB                 mov     edi, ebx
[...]
000B19FD                 xor     ebx, ebx
000B19FF
000B19FF loc_B19FF:                              ; CODE XREF: copy_nvram_data?+6Aj
000B19FF                 cmp     ebx, edi
[...]
000B1A03                 mov     edx, ecx
000B1A05                 add     ecx, 4
[...]
000B1A50                 inc     ebx
000B1A51                 add     esi, 4
```

Further down the stack, we have a write to `[ebx]`, which is originally `edi+0x60` in the listing above.
```
000B0E16                 mov     eax, 6838h
000B0E1B                 call    sub_21263
000B0E20                 mov     [ebx], eax
```

Register `0x6838` seems to be undocumented, and I can only speculate it controls read access of
NVRAM. We saw earlier that there are 8 entries in the directory each one 12 bytes long, overall 0x60 bytes:
we can assume `edi+0x60` points into memory just after the directory table.
If we succeed in finding an entry that triggers the copy, we set a flag:
```
0002BC55                 mov     [esp+1Ch+var_18], 1
```
and then decide where to dispatch execution:
```
0002BC62 loc_2BC62:                              ; CODE XREF: dir_find_entry+56j
0002BC62                 cmp     [esp+1Ch+var_10], 80h
0002BC67                 jb      loc_2BDA4
0002BC6D                 cmp     [esp+1Ch+var_18], 0
0002BC72                 jz      loc_2BD96
0002BC78                 xor     ecx, ecx
0002BC7A                 jmp     short loc_2BC86
```

`esp+1Ch+var_10` is `0x0` and represent the id of the entry we are trying to add to the table.
As this is `< 0x80`, we jump further ahead. If instaed the id was `> 0x80` and `esp+1Ch+var_18` 
was 0x0 we would jump to a control path where what stands out is:

```
0002A277                 push    edx
0002A278                 push    offset aDircreate_extd ; "\ndirCreate_Extdir.
```

This seems to be creating the extended directory table, so we can speculate that the leftmost
byte of the field in the directory entry which we checked against `0x10` might indicate its type,
and 0x10 might represent the extended directory. When attempting to add an entry with
id `> 0x80`, which at this point is unclear what it represents, if the extended directory is not
found, it gets created.

`esi` contains the callers' `esp+140h+var_1C`, where it expects to find an entry id to use. Once
past the look-up of the extended directory, we start scanning through the base entries in the 
directory table, starting from 0:
```
0002BDA4 loc_2BDA4:                              ; CODE XREF: dir_find_entry+11Aj
0002BDA4                 mov     dword ptr [esi], 0
0002BDAA                 jmp     short loc_2BDBA
```

We then follow a similar pattern seen before, and check content at `+4` offset against 
`0x3FFFFF`:
<details> <summary>Expand code</summary>
{% highlight asm %}
0002BDBA loc_2BDBA:                              ; CODE XREF: dir_find_entry+25Dj
0002BDBA                 mov     edx, [esi]
0002BDBC                 mov     eax, edx
0002BDBE                 shl     eax, 2
0002BDC1                 sub     eax, edx
0002BDC3                 shl     eax, 2
0002BDC6                 add     eax, edi
0002BDC8                 mov     ecx, [eax+4]
0002BDCB                 and     ecx, 0FF000000h
0002BDD1                 shr     ecx, 18h
0002BDD4                 mov     edx, [eax+4]
0002BDD7                 and     edx, 0FF0000h
0002BDDD                 shr     edx, 8
0002BDE0                 or      ecx, edx
0002BDE2                 mov     edx, [eax+4]
0002BDE5                 and     edx, 0FF00h
0002BDEB                 shl     edx, 8
0002BDEE                 or      edx, ecx
0002BDF0                 mov     ecx, [eax+4]
0002BDF3                 and     ecx, 0FFh
0002BDF9                 shl     ecx, 18h
0002BDFC                 or      edx, ecx
0002BDFE                 test    edx, offset unk_3FFFFF
{% endhighlight %}
</details>
<br>
Also similarly to the first scan, we check bits `[24,31]` against 
`esp+1Ch+var_10`, which we now know for sure contains the id of the entry 
(`0x0` for PXE).

```
0002BE06                 mov     ecx, edx
0002BE08                 shr     ecx, 18h
0002BE0B                 and     ecx, 0FFh
0002BE11                 xor     edx, edx
0002BE13                 mov     dl, [esp+1Ch+var_10]
0002BE17                 cmp     ecx, edx
```

If we find an entry with a matching id, we perform an additional check:
```
0002BE1B                 cmp     [esp+1Ch+var_1C], 0
0002BE1F                 jz      loc_2BD21
0002BE25                 mov     dword ptr [eax+4], 0
```

`esp+1Ch+var_1C` is a flag passed by the caller, with value `0x1`. We then
zero out the value at offset `+4` and exit, with the entry id in `[esi]` for
the caller to find. After having identified an entry in the table,
we look for NVRAM space to host the data:

```
0002AFF1                 mov     ebx, [esp+140h+var_14]
0002AFF8                 lea     edx, [esp+140h+var_20]
0002AFFF                 mov     eax, esp
0002B001                 call    sub_29682
```

Here I have taken a shortcut and as I haven't dived into the details of NVRAM space management.
I'll leave that for a possible future exercise. The strategy I am planning to use is to reserve 
initially a large enough portion of flash by writing a larger PXE Option Rom through the Broadcom
tool in MS-DOS environment, and then iterate on top of the same entry with smaller ROMs without 
having to worry about space allocation.

The code then sets new values in the directory entry. We see a similar pattern as 
before: if the ID is `> 0x80`, we jump to the extended directory update section, otherwise we follow
the base directory path.

```
0002B0F3 loc_2B0F3:                              ; CODE XREF: program_NVRAM_maybe_update_directory+1CDj
0002B0F3                                         ; program_NVRAM_maybe_update_directory+1E1j
0002B0F3                 mov     eax, [esp+140h+var_1C]
0002B0FA                 push    eax
0002B0FB                 push    offset aDirwriteIndexI ; "\ndirWrite, index is %x."
0002B100                 call    verbosity_8
0002B105                 add     esp, 8
0002B108                 mov     edx, [esp+140h+var_1C]
0002B10F                 cmp     edx, 80h
0002B115                 jl      loc_2B3E6
```

Before moving forward, we must note that the lenght of the OptionROM, stored in `esp+140h+var_14`
is aligned to 4 bytes boundaries and increased by 4, as the OptionROM data region will contain
also a trailing checksum:
```
0002AFB0                 test    byte ptr [esp+140h+var_14], 3
0002AFB8                 jz      short loc_2AFCD
0002AFBA                 mov     eax, [esp+140h+var_14]
0002AFC1                 and     al, 0FCh
0002AFC3                 add     eax, 4
0002AFC6                 mov     [esp+140h+var_14], eax
```

Furthermore `esp+140h+var_14` does not store the lenght alone. The value is multiplied by 4
as it represents then number of double words (4 bytes). `esp+140h+var_10`, which is the id 
of the entry, is then stored in the 6 most significant bits

```
0002B0A5                 mov     ecx, [esp+140h+var_14]
0002B0AC                 shr     ecx, 2
0002B0AF                 mov     [esp+140h+var_14], ecx
0002B0B6                 xor     eax, eax
0002B0B8                 mov     al, [esp+140h+var_10]
0002B0BF                 shl     eax, 18h
0002B0C2                 mov     ebx, ecx
0002B0C4                 or      ebx, eax
```

The resulting value is written to at `+4` of the selected index:

```
0002B3E6 loc_2B3E6:                              ; CODE XREF: program_NVRAM_maybe_update_directory+20Dj
0002B3E6                 mov     ecx, [esp+140h+var_14]
0002B3ED                 and     ecx, 0FF000000h
0002B3F3                 shr     ecx, 18h
0002B3F6                 mov     eax, [esp+140h+var_14]
0002B3FD                 and     eax, 0FF0000h
0002B402                 shr     eax, 8
0002B405                 or      ecx, eax
0002B407                 mov     eax, [esp+140h+var_14]
0002B40E                 and     eax, 0FF00h
0002B413                 shl     eax, 8
0002B416                 or      ecx, eax
0002B418                 mov     eax, [esp+140h+var_14]
0002B41F                 and     eax, 0FFh
0002B424                 shl     eax, 18h
0002B427                 or      ecx, eax
0002B429                 mov     eax, edx
0002B42B                 shl     eax, 2
0002B42E                 sub     eax, edx
0002B430                 mov     [esp+eax*4+4], ecx
```

At offset `+0`, a value set by the caller gets written. On the PXE update path, it seems to be
always `0x100000`, which is coherent with the dumps of the NVRAM seen earlier:

```
0002B434                 mov     ecx, esi
0002B436                 and     ecx, 0FF000000h
0002B43C                 shr     ecx, 18h
0002B43F                 mov     edx, esi
0002B441                 and     edx, 0FF0000h
0002B447                 shr     edx, 8
0002B44A                 or      ecx, edx
0002B44C                 mov     edx, esi
0002B44E                 and     edx, 0FF00h
0002B454                 shl     edx, 8
0002B457                 or      edx, ecx
0002B459                 mov     ecx, esi
0002B45B                 and     ecx, 0FFh
0002B461                 shl     ecx, 18h
0002B464                 or      edx, ecx
0002B466                 mov     [esp+eax*4], edx
```
At offset `+8` we write the NVRAM address returned by `sub_29682`, the function which looks up space in NVRAM:
```
0002B469                 mov     ecx, [esp+140h+var_20]
0002B470                 and     ecx, 0FF000000h
0002B476                 shr     ecx, 18h
0002B479                 mov     edx, [esp+140h+var_20]
0002B480                 and     edx, 0FF0000h
0002B486                 shr     edx, 8
0002B489                 or      ecx, edx
0002B48B                 mov     edx, [esp+140h+var_20]
0002B492                 and     edx, 0FF00h
0002B498                 shl     edx, 8
0002B49B                 or      edx, ecx
0002B49D                 mov     ecx, [esp+140h+var_20]
0002B4A4                 and     ecx, 0FFh
0002B4AA                 shl     ecx, 18h
0002B4AD                 or      edx, ecx
0002B4AF                 mov     [esp+eax*4+8], edx
```

NVRAM is then overwritten with the modified directory.

Integrity checksums
=======
There are multiple integrity values stored in NVRAM. Two are immediately obvious from the binary diff
shown at the beginning of the post, i.e. a 1 byte checksum at offset `0x75` and a 4 bytes checksum at offset `0xFC`,
in the directory area. There is also a third "hidden" checksum covering the  OptionROM binary itself. In fact, we 
have seen earlier that the OptionROM size stored in the directory corresponds to the size of the binary `+4` bytes, 
indicating that something is appended to the EFI blob.

`sub_2AF08` is the main function which programs NVRAM data and directory metadata and `sub_2BEAD` gets us to the calculation of the integrity values:

```
0002BF0E                 mov     ebx, 1
0002BF13                 mov     edx, 60h
0002BF18                 lea     eax, [esp+8Ch]
0002BF1F                 call    sub_4F781
0002BF24                 mov     [esp+1], al
0002BF28                 mov     ebx, 0FFFFFFFFh
0002BF2D                 mov     edx, 88h
0002BF32                 mov     eax, esp
0002BF34                 call    sub_67BF9
0002BF39                 mov     [esp+88h], eax
0002BF40                 mov     edx, eax
0002BF42                 not     edx
0002BF44                 mov     [esp+88h], edx
0002BF4B                 mov     ebx, 23h
0002BF50                 mov     edx, esp
0002BF52                 mov     eax, 74h
```

`[esp+1]` and `[esp+88h]` indicate that the resulting value of `sub_4F781` and `sub_67BF9`, which we'll see are checksum
calculation routines. These are copied over at `+1` and `+88h` offsets of a memory buffer which if we try to map 
to the binary diff of the NVRAM area, where we have a 1 byte difference at `0x75` and 4 bytes difference
at `0xFC`, we can see they are equally distanced. If `esp+88h = 0xFC`, then `esp` == 0x74 and `esp+1 == 0x75`.

`sub_4F781` and `sub_4F781` calculate integrity values respectively on `0x60` and `0x88` bytes read from
NVRAM through `sub_B119EA`. We see two invocations of `sub_B119EA`, which prepare the data to be checksummed:

```
0002BEC0                 mov     ebx, 18h
0002BEC5                 lea     edx, [esp+8Ch]
0002BECC                 mov     eax, 14h
0002BED1                 call    sub_B119EA
```

and 
```
0002BEF9                 mov     ebx, 23h
0002BEFE                 mov     edx, esp
0002BF00                 mov     eax, 74h
0002BF05                 call    sub_B119EA
```

The meaning of the parameters are the following:
* `eax` contains the offset in NVRAM from which to copy the data over to `[esp+8C]` and `[esp]`
* `ebx` contains the size to be copied still to be intended as the number of double words (4 bytes. This can be
easily seen by following  `sub_B119EA`)


Once the data is available `sub_4F781` and `sub_67BF9` calculate respectively 1 and 4 bytes checksums. Here Ghidra provides relatively
accurate decompiled versions of the two functions. For `sub_4F781`:

```
uint __regparm3 UndefinedFunction_0004f78b(char *param_1,int param_2)

{
  char unaff_BL;
  byte bVar1;
  
  bVar1 = 0;
  while (param_2 = param_2 + -1, param_2 != -1) {
    bVar1 = bVar1 + *param_1;
    param_1 = param_1 + 1;
  }
  if (unaff_BL != '\0') {
    return (uint)param_1 & 0xffffff00 | (uint)(byte)(~bVar1 + 1);
  }
  return (uint)param_1 & 0xffffff00 | (uint)bVar1;
}
```

For `sub_67BF9`:
```
uint __regparm3 UndefinedFunction_00067c06(byte *param_1,uint param_2)

{
  uint uVar1;
  uint uVar2;
  uint unaff_EBX;
  uint uVar3;
  uint uVar4;
  
  for (uVar4 = 0; uVar4 < param_2; uVar4 = uVar4 + 1) {
    uVar2 = (uint)*param_1;
    uVar1 = 0;
    param_1 = param_1 + 1;
    do {
      if (((unaff_EBX ^ uVar2) & 1) == 0) {
        uVar3 = 0;
      }
      else {
        uVar3 = 0xedb88320;
      }
      unaff_EBX = unaff_EBX >> 1 ^ uVar3;
      uVar2 = uVar2 >> 1;
      uVar1 = uVar1 + 1;
    } while (uVar1 < 8);
  }
  return unaff_EBX;
}
```



We can then summarize these first two integrity values as follows:
* We copy `96` (`0x60`) bytes from NVRAM starting at offset `0x14`, and calculate a 1 byte checksum. We copy this checksum to offset `0x75`. This region of memory is the directory, 8 entries of 12 bytes each.
* We copy `140` (`0x88`)  bytes from NVRAM starting at offset `0x74`, and calculate a 4 byte checksum. We copy this checksum to offset `0xFC`. This region of memory seems to be containing other VPD data.

We get to a similar conclusion for the integrity check of the OptionROM itself. In the main PXE update function, `sub_98542`, we can first track the size of the image:
```
000986E8 loc_986E8:                              ; CODE XREF: sub_98542+17E
000986E8                 push    edi
000986E9                 push    offset aLengthDBytes__ ; "(length = %d bytes ) ...\n"
```

If we follow `edi` backwards, we can track the invocation of `sub_67BF9`, the routine which calculates the 4 bytes checksum:
```
00098678                 mov     edx, edi
0009867A                 mov     eax, esi
0009867C                 call    sub_67BF9
00098681                 mov     edx, eax
00098683                 not     edx
00098685                 lea     eax, [esi+edi]
00098688                 mov     [eax], edx
0009868A                 push    offset aUpdatingPxe ; "Updating PXE "
0009868F                 xor     eax, eax
00098691                 mov     al, [esp+44h+var_10]
00098695                 push    eax
00098696                 add     edi, 4
```

The only argument to `sub_67BF9` is the size of the image, which doesn't include yet the 4 additional bytes. 
The result is stored at `esi+edi`, i.e. the base address of the OptionROM in memory + its length. The lenght of the image 
is then increased by 4 before being stored in the directory.


Device initialization
=======

Programmatically updating PXE ROM
=======
Based on the exploration presented in this post, we can derive the following "fast" update algorithm for OptionROM:
* Verify the integrity to the directory
* Search through the directory to find an entry dedicated to id == 0x0
* 

Corrupted NVRAM
=======

