---
layout: post
title:  "C++ move semantics and rvalue reference"
date:   2016-11-26 08:00:00
published: yes
categories: programming cpp
pygments: true
summary: "A collection of some notes on move semantics, rvalue reference, universal
reference and forwarding. Just to consolidate some knowledge that I don't get
to apply on daily basis and, as a consequence, tends to fade out a bit in the long
run. "

---

Constructor, Copy Constructor and Move Constructor
=======

Let's consider a class with constructor, copy constructor, move constructor,
copy assignment operator and move assignment operator.

```c++
class MyClass {

public:
  int _value;
  MyClass() {
    cout << "Default constructor " << endl;
  }

  MyClass(int value) {
    cout << "Constructor " << value <<  endl;
    this->_value = value;
  }

  MyClass(MyClass &rhs) {
     cout << "Copy constructor" << endl;
     this->_value = rhs._value;
  }

  MyClass& operator=(MyClass &rhs) {
      cout << "Copy assignment operator" << endl;
      this->_value = rhs._value;
  }

  MyClass& operator=(MyClass &&rhs) {
      cout << "Move assignment operator" << endl;
      this->_value = rhs._value;
      rhs._value = -1;
  }

  MyClass(MyClass &&rhs) {
      cout << "Move constructor" << endl;
      this->_value = rhs._value;
      rhs._value = -1;
  }
  ~MyClass() {
      cout << "Destructor" << endl;
   }
};
```

I won't go into detail on what the difference is between *rvalue* and *lvalue*,
I will limit myself to summing up some construction scenario. Some first basic
cases, with the code on the left and the output on the right.

```
 1  MyClass a(10);    Constructor 10
 2  MyClass b(a);     Copy constructor
 3  b = a;            Copy assignment operator
 4  MyClass c = b;    Copy constructor
 5                    Destructor
 6                    Destructor
 7                    Destructor
```
These examples are all well known under C++98, probably the only remark worth pointing
out is the invocation of the copy constructor on line 2 and 4.
In the context of C++11, the introduction of rvalue references allows to implement
move semantics: when constructing an object from a reference to an rvalue, the code
can transfer ownership of resources from that argument to the object being constructed, 
with the awareness that the original one needs to be left in a consistent state but the caller
will not expect it to hold an initialized value anymore. This
is exactly what is being done in a very simplified way in the move constructor
of *MyClass*. The old object loses ownership of a certain resource while still
being left in a consistent state. In this case there is solely an integer value moved around:
a more meaningful example would be the transfer of ownership of a dynamically allocated
buffer, even though modern C++ offers plenty of ways to avoid having to deal with
memory bookkeeping. In the examples below, lines 2 and 4 result
in a call to the move assignment operator and move constructor.
```
 1  MyClass c(10);           Constructor 10
 2  c = MyClass(20);         Constructor 20
 3                           Move assignment operator
 4  MyClass a(MyClass(10));  Constructor 10
 5                           Move constructor
 6                           Destructor
 7                           Destructor
 8                           Destructor
 9                           Destructor
```
One remark must be made concerning the creation on line 4: here a temporary 
object is created, which is again an rvalue and object *a* is move constructed from it.
This is however not the default behaviour of gcc (version *4.9* in my case). The 
compiler, if not asked otherwise, optimizes away the creation of the temporary. 
To disable this behavior, the *-fno-elide-constructors* flag must be used.
The idea behind move semantics is to avoid the overhead of copy constructing an object
when not strictly necessary. Let's consider for example the two functions below:





