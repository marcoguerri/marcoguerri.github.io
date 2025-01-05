---
layout: post
title:  "Exploiting buffer overflow through static binary analysis"
date:   2024-06-22 08:00:00
published: true
pygments: true
toc: true
hidden: true
tags: [ctf, static-analysis, buffer-overflow]
---

The challenge
=======
The challenge consists in an ELF binary reachable over the network which allegedly contains a buffer
overflow. Connecting to the endpoint, or running the binary locally, shows an interactive prompt, where
a number is displayed as follows:
```
1?
```
Depending on the input, we might see another number in output, either the same or incremented by one.
It is reasonable to expect that based on our input, we might be able to trigger a buffer overflow and
execute code to retrieve a flag. The general idea is exactly that, with some additional complexity on
top.

Execution flow
=======

The ELF entry point is `0x8048540`

```
$ readelf -a vuln   | grep Entry
  Entry point address:               0x8048540
```

`radare2` correctly identifies `entry0` at that address:

```
┌ 50: entry0 ();
│           0x08048540      31ed           xor ebp, ebp                ; [14] -r-x section size 1065458 named .text
│           0x08048542      5e             pop esi
│           0x08048543      89e1           mov ecx, esp
```

which terminates in a call to `__libc_start_main`:

```
│           0x08048566      c7c02cc21408   mov eax, 0x814c22c
│           0x0804856c      50             push eax                    ; func main
└           0x0804856d      e85effffff     call sym.imp.__libc_start_main 
```

In fact, if we build the call graph from `entry0`, we see only two functions are reached, `__libc_start_main` and
`fcn.08048573`.

```
[0x08048540]> agc @entry0
               ┌────────────────────┐
               │  entry0            │
               └────────────────────┘
                     t
                     │
      ┌──────────────│
      │              └──────────┐
      │                         │                        
┌────────────────────┐    ┌─────────────────────────────┐
│  fcn.08048573      │    │  sym.imp.__libc_start_main  │
└────────────────────┘    └─────────────────────────────┘
```

`__libc_start_main` is the trampoline to the `main()` entry point and expects its address to be
passed as first argument.
```
│           0x08048566      c7c02cc21408   mov eax, 0x814c22c
│           0x0804856c      50             push eax                    ; func main
└           0x0804856d      e85effffff     call sym.imp.__libc_start_main
```

We can therefore conclude that `0x814c22c` is our `main()` function. It seems however `radare2`
cannot find a function at that address:
```
[0x08048540]> pdf @0x814c22c
ERROR: Cannot find function at 0x0814c22c
```

This is because `entry0` points to a few instructions earlier than the prologue of `main()` function:
```
[0x08048540]> pd @0x814c22c
            ; DATA XREFS from entry0 @ 0x8048566(r), 0x804856c(w)
            0x0814c22c      8d4c2404       lea ecx, [esp + 4]
            0x0814c230      83e4f0         and esp, 0xfffffff0
            0x0814c233      ff71fc         push dword [ecx - 4]
┌ 1172: fcn.0814c236 ();
│           ; var int32_t var_8h @ ebp-0x8
│           ; var int32_t var_ch @ ebp-0xc
│           0x0814c236      55             push ebp
```

Our "real" `main()` is in fact at `0x0814c236`. It is structured as a sequence of function calls,
similar to the following:
```
FUN_0811d5b3();
FUN_0811d941();
puts("fizz");
FUN_0811ead2();
[...]
```
where each `FUN_` consists of a sequence of nested calls to one common function, `FUN_080486b1`:
```
iVar1 = FUN_080486b1(2);
if (iVar1 != 2) {
  FUN_0814668f();
  iVar1 = FUN_080486b1(0xd);
  if (iVar1 != 0xd) {
    FUN_08122908();
    iVar1 = FUN_080486b1(10);
    [...]
```

The logic for generating and consuming the numbers mentioned in the previous section lives in `FUN_080486b1`, 
which implements  some sort of fizz/buzz algorithm. It is enough to quickly skim through the code to come to 
this conclusion. In addition to numbers, one might need to provide in input `fizz`, `buzz`, or `fizzbuzz` 
depending on modulo operations. `FUN_080486b1` takes one integer argument, `<NUM>` and returns the same `<NUM>` 
only if the fizz/buzz sequence goes through that many steps. If the wrong input is given, the sequence is 
interrupted before reaching `<NUM>` and the current counter value, which starts from 1, is returned. 

As an 
example, for the invocation `FUN_080486b1(4)`, we need to provide 3 correct values for the 
function to return 4. This can be verified locally under a debgger by breaking after `FUN_080486b1` returns. 
To get that address where to set the breakpointer, we can initially break on `FUN_080486b1` and inspect the
stack trace that got us there:

```
Breakpoint 1, 0x080486b1 in ?? ()
Missing separate debuginfos, use: dnf debuginfo-install glibc-2.37-19.fc38.i686
(gdb) bt
#0  0x080486b1 in ?? ()
#1  0x0811d5cd in ?? ()
#2  0x0814c26d in ?? ()
#3  0xf7dca9b9 in __libc_start_call_main () from /lib/libc.so.6
#4  0xf7dcaa7c in __libc_start_main_impl () from /lib/libc.so.6
#5  0x08048572 in ?? ()
```

So, we can break on `0x0811d5cd` and inspect the return value of `FUN_080486b1` while providing good or bad
input. If the sequence is correct, we get 0x4 as return value::
```
(gdb) break *0x0811d5cd
Breakpoint 1 at 0x811d5cd
(gdb) run
1? 1
2? 2
3? fizz

Breakpoint 1, 0x0811d5cd in ?? ()
Missing separate debuginfos, use: dnf debuginfo-install glibc-2.37-19.fc38.i686
(gdb) info registers eax
eax            0x4                 4
```
If the sequence is wrong, we get the highest value reached:
```
(gdb) break *0x0811d5cd
Breakpoint 1 at 0x811d5cd
(gdb) run
1? 1
2? 88

Breakpoint 1, 0x0811d5cd in ?? ()
Missing separate debuginfos, use: dnf debuginfo-install glibc-2.37-19.fc38.i686
(gdb) info registers eax
eax            0x2                 2
```
As shown in the previous disassembled code, the execution then consists in a sequence of nested blocks,
where we go one level deeper if we fail to reach `<NUM>` in the invocation of `FUN_080486b1`.

```
NESTED_BLOCK := 
    iVar1 = FUN_080486b1(2);
    if (iVar1 != 2) {
        <NESTED BLOCK>
    }
```

Based on this, we can control execution flow with our input.

Buffer overflow
=======
We know we can control execution flow, so presumably we can land on abuffer overflow. We need to get
an idea where that might be though. In the list of external functions invoked from `libc`, `fgets`
appears many times, with the same pattern, i.e.:

```  
  char local_42 [50];
  int local_10;
  
  local_10 = FUN_080486b1(0x21);
  if (local_10 == 1) {
    fgets(local_42,0x28,stdin);
  [...]
```

There might be instances where `fgets` overflows the space allocated on the stack. Static analysis
is the only way to find if those exist, as Ghidra reports 19757 callsites. In this example I will be
using `radare2` wrapped into a Rust library, but anything equivalent will do. First, we can extract
all callsites for `fgets`:
```
axtj @ sym.imp.fgets
```

We can then derive where `fgets` is being called and disassemble the initial instructions of the function:
```
pdj 5 @ <CALL_ADDR>
```
The expectation is that `$esp` is decreased to make room for `local_42` and
`local_10` variables above. We then extract the second argument passed to `fgets` from the stack and compare
the two values. If `fgets` consumes more bytes than `$esp` allows for, we have found an overflow.
The code in REF does exactly this and it successfully finds one of such configurations at `FUN_0808ae73`:

```
  char local_67 [87];
  int local_10;
  
  local_10 = FUN_080486b1(0x14);
  if (local_10 == 1) {
    fgets(local_67,0x15c,stdin);
```
`0x15c` is clearly overflowing 87 bytes + the integer.

fizz-buzz algorithm
====
We need to look into the sequence implemented by `FUN_080486b1`, i.e. the fizz-buzz algorithm, to control
execution flow. The code in `FUN_080486b1` is slightly obfuscated and relies on integer oveflow to
determine when `fizz`, `buzz` or `fizzbuzz` should appear. Starting from `fizzbuzz`, we have the following:
```
0804872f ba 89 88        MOV        EDX,0x88888889
         88 88
08048734 89 c8           MOV        EAX,ECX
08048736 f7 e2           MUL        EDX
08048738 89 d0           MOV        EAX,EDX
0804873a c1 e8 03        SHR        EAX,0x3
0804873d 89 c2           MOV        EDX,EAX
0804873f c1 e2 04        SHL        EDX,0x4
08048742 29 c2           SUB        EDX,EAX
08048744 89 c8           MOV        EAX,ECX
08048746 29 d0           SUB        EAX,EDX
08048748 85 c0           TEST       EAX,EAX
[ if equal, expect "fizzbuzz" ]
```
EDX EAX
1000  00000000000000000000000000000111
10000 00000000000000000000000000001110

EAX 1000 >> 3 == 0x1
EDX 10000
EDX = 10000 - 0x1 = 15

EAX 10000 >> 3 = 10
EDX 100000

32 - 2 = 30





The value for the modulo operation in the fizz-buzz algorithm are not immediately obvious.




