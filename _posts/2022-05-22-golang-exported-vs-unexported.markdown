---
layout: post
title:  "Exported and unexported fields in Golang"
date:   2022-04-24 08:00:00
published: false
categories: go programming
pygments: true
---

Summary
=======
I have been wrapping my head around the limitations of unexported fields in Golang and I wanted to share some thoughts on why I don't like how Go conflates concepts of 
"state", "visibility" and "serialization" together, forcing to take decision that are suboptimal with respect to any of these.


Unexported fields are essentially not part of a public API. As such, they are not supposed to be accessed nor modified from outside the package. They might convey information 
that is publicly documented, but it's not expected that the details of how unexported fields are manage are described.

Possible cases for when not to export fields are the following:
* Internal state that should not be known to the outside world
* Fields that hold complex meaning that needs to be managed in conjunction with other fields. These need to be coherent together, accessing them individually


 and nobody outside the package should
have any understanding of they are supposed to be used. 

Taking as an example the following structure.

// Blob represents 
type Blob struct {
    compressed bool
    compressionScheme uint8
    date []byte
}


Golang doesn't provide any safety access guarantees, so trying to unexport fields for safety is a lost cause.

The model/view/controller argument.
