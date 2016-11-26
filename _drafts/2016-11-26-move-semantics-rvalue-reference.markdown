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
  }

  MyClass& operator=(MyClass &&rhs) {
      cout << "Move assignment operator" << endl;
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
 5  c = MyClass(20);  Constructor 20
 6                    Move assignment operator
 7                    Destructor
 8                    Destructor
 9                    Destructor
10                    Destructor
```
Examples on line 1 to 4 are well known in C++03 and C++98. In the context of C++11,
the assignment on line 5 is the most interesting: here the rhs of the assignment 
is a temporary object and therefore an rvalue: the move assignment operator will bind
to this expression. Another interesting scenario related to move semantics is the 
following:

```
MyClass a(MyClass(10));
```
Here one would expect to see the construction of a temporary object and the subsequent
move construction of *a* from that rvalue. However, the compiler by default
(*gcc 4.9* in this case), optimizes away the first step. To disable the optimization,
the *-fno-elide-constructors* flag must be used, resulting in the output below.

```
 1  MyClass a(MyClass(10));  Constructor 10
 2                           Move constructor
 3                           Destructor
 4                           Destructor
```









