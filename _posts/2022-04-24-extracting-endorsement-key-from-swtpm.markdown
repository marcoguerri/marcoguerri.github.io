---
layout: post
title:  "Extracting Endorsement Key from swtpm state"
date:   2022-04-24 08:00:00
published: false
categories: tpm2 cryptography
pygments: true
---

Summary
=======
The RSA key is created from crypto/openssl/CryptRsa.c

by CryptRsaGenerateKey, provided the random seed is correctly unmarshalled


DRBG_STATE_Unmarshal is what unmarshals the state of the swtpm

We can use PERSISTENT_ALL_Unmarshal to unmarshal everything in src/tpm2/NVMarshal.c in libtpms


Modify src/libtpms.syms and add PERSISTENT_ALL_Unmarshal to export the symbol (global sectioN)

Final command line:

g++ unmarshal_persistent.cpp -o main -I /home/marcoguerri/dev/activatecredentials/libtpms/src/tpm2 -I /home/marcoguerri/dev/activatecredentials/libtpms/src/tpm2/crypto/openssl/ -I /home/marcoguerri/dev/activatecredentials/libtpms/src/tpm2/crypto/   -DTPM_POSIX -L /home/marcoguerri/dev/activatecredentials/libtpms/src/.libs -ltpms
 
CryptRsaGenerateKey also needs to be exported through src/libtpms.syms;

The RSA structure consists in the following:

1982 /* Table 2:167 - Definition of TPM2B_PRIVATE_KEY_RSA Structure  */
1983 typedef union {
1984     struct {
1985     UINT16                  size;
1986     BYTE                    buffer[RSA_PRIVATE_SIZE];
1987     }            t;
1988     TPM2B        b;
1989 } TPM2B_PRIVATE_KEY_RSA;


The random state is re-seded, so the EK needs to be persisted


with tpm2_createek -c - -u ek.pub.tss, it doesn't create a context object, but stores directly into peristent handle

tpm2_readpublic -c 0x80000000 returns the EK.


$ tpm2_createek -c - -u ek.pub.tss   
persistent-handle: 0x81000000

The value is not changed
