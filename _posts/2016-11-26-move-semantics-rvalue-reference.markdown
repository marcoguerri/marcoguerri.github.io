---
layout: post
title:  "C++ move semantics and rvalue reference"
date:   2016-11-26 08:00:00
published: yes
categories: programming cpp
pygments: true
summary: "A collection of some notes on move semantics, rvalue reference, type
deduction and forwarding, just to consolidate some knowledge on C++11/14. The content
of this post is mostly a re-elaboration of the information provided by
Scott Meyer's \"Effective Modern C++\""

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

Some first basic construction scenarios are shown below, with the code on the 
left and the output on the right.

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
with the awareness that the original one needs to be left in a consistent state but 
the caller will not expect it to hold an initialized value anymore. As a matter
of fact, with a proper rvalue, the caller will not even be able to tell if the object
has been modified or not, due to the temporary nature of rvalues. 
\\
A simplified example of move semantics is implemented the move constructor
of *MyClass*. The old object loses ownership of a certain resource while still
being left in a consistent state. In this case there is solely an integer value 
moved around: a more meaningful example would involve transferring ownership of a 
dynamically allocated buffer while setting the old object's pointer to *nullptr*.
In the examples below, lines 2 and 4 result in a call to the move assignment 
operator and move constructor.

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
Something very similar happens with *RVO* (Return Value Optimization) and *NRVO*
(Named return value optimization). *-fno-elide-constructors* will disable this behavior.

Moving from lvalues: std::move and std::forward
=======
Sometimes it becomes necessary to treat *lvalues* as *rvalues*, thus allowing the 
function being invoked to move from a specific argument. *std::move* does exactly this,
by returning an *rvalue reference* to its argument, which 
will eventually bind to functions accepting *rvalues* like a move constructor (unless
there is a *const* qualifier involved at some point). As *std::move*, *std::forward*
is also responsible for casting the argument to an rvalue, but it does so
only if certain conditions are met. The first and foremost scenario where
*std::forward* comes to play is function templates which take universal references
as arguments.


Universal references and type deduction
=======
Type deduction refers to the operation of statically dispatching a call at compile
time based on the types involved in the invocation. The first and foremost scenario
where the compiler implements type deduction is function templates, which are 
normally declared as follows.

```c++
template <typename T> void func(ParamType arg) 
{
    [...]
}
```
*ParamType* is basically *T* enriched with qualifiers (e.g. *const*), references,
or pointers. Considering the template function defined above, there are three 
possible scenarios:

  * ParamType is a pointer or a reference, but does not have the form of *T&&*
   (which instead would be a universal reference): in this case the reference part
    of the argument passed to the function can be ignored and *T* deduced 
    consequently.

  * ParamType is a universal reference, i.e. a reference which binds to both
    lvalues and rvalues (which appears as *T&&*). If the argument of the call is 
    an *lvalue*, both *T* and *ParamType* are lvalue references. On the contrary
    if the argument is an *rvalue* the analysis of case 1 applies.

  * ParamType is neither a pointer nor a reference. In this case, the argument
    is passed by value. If the argument is a reference, the reference part can
    be ignored to deduce *T*. *arg* is copy constructed an therefore independent
    of any additional qualifier like *const* or *volatile* (unless, in case of
    a pointer, *const* refers to the data being pointed to).

In the context of C++, type deduction is extended also to *auto* type and *decltype*. 

[Work in progress...]





