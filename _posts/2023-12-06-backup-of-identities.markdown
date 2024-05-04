---
layout: post
title:  "Password keyring back-up and disaster recovery"
date:   2024-10-13 08:00:00
published: true
pygments: true
toc: true
tags: [disaster-recovery, cryptography]
---

Walk-through of my password keyring back-up and recovery strategies.

Generating ed25519 key
======

```
openssl genpkey -algorithm ed25519
```

You can read the private key:

```
$ openssl ec -in private.pem -text -noout           
read EC key
ED25519 Private-Key:
priv:
    11:eb:0d:26:15:9d:09:88:26:de:e5:77:33:88:4f:
    02:3f:e1:27:ad:42:ca:2a:2a:83:02:e8:b2:f0:11:
    11:6f
pub:
    4a:5b:11:12:1b:3f:c8:9c:ec:41:45:b3:10:be:a9:
    32:4b:63:85:73:e4:56:30:52:6d:b8:67:1b:df:b2:
    5d:6
```


Turn private key file from pem to der

```
openssl pkey -inform pem -in private.pem -outform der > pkey.der
```

Raed the asn1 structure:

```
$ openssl asn1parse -in pkey.der -inform der
    0:d=0  hl=2 l=  46 cons: SEQUENCE          
    2:d=1  hl=2 l=   1 prim: INTEGER           :00
    5:d=1  hl=2 l=   5 cons: SEQUENCE          
    7:d=2  hl=2 l=   3 prim: OBJECT            :ED25519
   12:d=1  hl=2 l=  34 prim: OCTET STRING      [HEX DUMP]:042011EB0D26159D098826DEE57733884F023FE127AD42CA2A2A8302E8B2F011116F
```

According to DER encoding rules, the OCTET STRING is serialized in Tag-Length-Value format, so our key is `11EB0D26159D098826DEE57733884F023FE127AD42CA2A2A8302E8B2F011116F`m which matches `openssl` output above.

From this secret, one can also re-built the DER encoded private key.

We can use the header

`302e020100300506032b657004220420` and then append the private key.

```
echo "302e020100300506032b65700422042011EB0D26159D098826DEE57733884F023FE127AD42CA2A2A8302E8B2F011116F" | xxd -r -ps > key.der
```


We don't want to share directly the private key, but rather a pattern that has to be combined with a XOR OTP. We generate
first a XOR OTP, which could be another ED25519 key.

We can generate another key and convert it into DER format and use it a XOR OTP:

```
5B2DBDDDAB9D0682FFC888B66C13F20F76B90EBB11E7FF74A49461A031A5D4E
```

We can then XOR our private key, so

```
11EB0D26159D098826DEE57733884F023FE127AD42CA2A2A8302E8B2F011116F ^ 5B2DBDDDAB9D0682FFC888B66C13F20F76B90EBB11E7FF74A49461A031A5D4E
```

Result is `1459d6fbcf24d9e009226dfc55497022c88ab746f3d455ddc94baea8f30b4c21`. This is the secret that can be split into 3/4 scheme,
i.e.:

```
$ ssss-split -t 3 -n 4 -x
```

which results in

```
1-03f91d84889ad4ee636c430acfabb87cc24389a6af6aca1482c6446bdc807104
2-e675092b20b19d4e7412ef04aa89b616d6229a85a5a610fe4eb0f69ce4f48000
3-8c196ee60f44ca8891a9b8a0ac926efcb5dd1d3235cd408b15640875304eb90b
4-1ab76f6fc80178498591b073b3fa50c48f0748d6e38a268a7678e58ac74d302f
```

Translation to mnemonic seems to be rather trivial: https://learnmeabitcoin.com/technical/mnemonic


We get the following mnemonics (italian, 24 words):
```
1
aforisma segregato grammo armonia radicale maglia occidente negozio ammonito meschino tulipano vicinanza camerata scettro patacca troppo seminato polenta remare neretto rumoroso dote scapola pannello

2
timbro presenza essenza duomo barocco pratica simulato giallo aggancio foglio italia cloro grigio fachiro avviso ridurre arguto uscito pupilla trono sfuso marsupio abaco bere

3
nuovo serraglio ritardo blando evitato elfico enzima daniela pigro ignaro peloso vichingo ghisa offerta segnalato ritegno dozzina fumante fune arguto flamenco casaccio temerario longevo

4
bavosa rodaggio stasera omaggio bacino canapa avere cursore litigio piccino osare nessuno umorismo polmonite gasolio lessato carcassa fluoro pertugio sereno quadro postulato sarto treccia
```


We can then attempt to rebuild the secret from 3/4, say 1,2,4:

1-03f91d84889ad4ee636c430acfabb87cc24389a6af6aca1482c6446bdc807104
2-e675092b20b19d4e7412ef04aa89b616d6229a85a5a610fe4eb0f69ce4f48000
3-1ab76f6fc80178498591b073b3fa50c48f0748d6e38a268a7678e58ac74d302f

We get back the initial secret:
```
$ ssss-combine -t 3 -n 4 -x
Enter 3 shares separated by newlines:
Share [1/3]: 1-03f91d84889ad4ee636c430acfabb87cc24389a6af6aca1482c6446bdc807104
Share [2/3]: 2-e675092b20b19d4e7412ef04aa89b616d6229a85a5a610fe4eb0f69ce4f48000
Share [3/3]: 4-1ab76f6fc80178498591b073b3fa50c48f0748d6e38a268a7678e58ac74d302f
Resulting secret: 1459d6fbcf24d9e009226dfc55497022c88ab746f3d455ddc94baea8f30b4c21
```

We can then combine this with the XOR OTP (5B2DBDDDAB9D0682FFC888B66C13F20F76B90EBB11E7FF74A49461A031A5D4E).
We get back the ED25519 key: 11eb0d26159d098826dee57733884f023fe127ad42ca2a2a8302e8b2f011116f.

It's important that `ssss-combine` is fed with secrets splits with the right index associated:


Something that tripped me up was setting up rustls `TlsAcceptor` to accept test certificate for client authentication.
By looking at the `AllowAnyAuthenticatedClient` verifier, one can see that `ClientCertVerifier` implementation calls
`verify_for_usage` from `rustls-webpki`, which among other things checks:

```
 /// * `usage` is the intended usage of the certificate, indicating what kind
 ///   of usage we're verifying the certificate for.
```

This means that our client certificate needs to have extended attrbute indicating that the certificate can be used
for client validation. This can be done by adding the extension at the moment of creation of the certificate signing request:

```
openssl req -new -key client.com.key -out client.com.csr -addext "extendedKeyUsage=clientAuth"
```

When signing the CSR, the extension needs to be preserved explicitly, otherwise it will be lost, unless `openssl` configuration
file sets it as well. Extension can be preserved with `-copy_extensions copy`:

```
openssl x509 -req  -in client.com.csr -CA rootCA.crt -CAkey rootCA.key -CAcreateserial -out client.com.crt -days 500 -sha256  -copy_extensions copy
```

