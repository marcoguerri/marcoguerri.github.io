---
layout: post
title:  "Reversing Android Home Banking application"
date:   2022-02-13 08:00:00
published: false
categories: android reversing
pygments: true
---

Summary
=======
I don't use home banking apps on mobile, but I still wanted to look into my bank's 
app to get an idea of its security posture. Here's some notes I have taken during the
exercise.


Environment setup
=======
I used `vscodium` and APK lab extension for disassemblying the app. For testing, I set up 
a physical test device, a spare Samsung Galaxy Tab 3.0 that I had lying around running 
LineageOS 14.1 (Android 7.1.2). The `.apk` of the banking app was downloaded via Aurora 
store


Build environment
=======
The Samsung Galaxy Tab 3.0 is long discontinued, but it's still possible to set up a working
build environment for LineageOS 14.1. I setup a repository [for a build environment](https://github.com/marcoguerri/lineageos-build).


Aurora store allows to log in with Google account or as Anonymous user. There is also a third mode,
Anonymous insecure.

The Aurora Store UI then allows to download
