---
layout: post
title:  "C++ move semantics and rvalue reference"
date:   2016-11-26 08:00:00
published: yes
categories: programming cpp
pygments: true
---

Summary
======
This post walks through new concepts introduced by C++11 such as move semantics, rvalue reference, forwarding, 
and shows how they affect compile time and runtime behavior.

Constructor, Copy Constructor and Move Constructor
=======

Let's consider a class with constructor, copy constructor, move constructor,
copy assignment operator and move assignment operator.

{% highlight c++ linenos %}
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
{% endhighlight %}

Some first basic construction scenarios are shown below, with the code on the 
left and the output on the right.

{% highlight c++ linenos %}
MyClass a(10);    Constructor 10
MyClass b(a);     Copy constructor
b = a;            Copy assignment operator
MyClass c = b;    Copy constructor
                  Destructor
                  Destructor
                  Destructor
{% endhighlight %}

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
of `MyClass`. The old object loses ownership of a certain resource while still
being left in a consistent state. In this case there is solely an integer value 
moved around: a more meaningful example would involve transferring ownership of a 
dynamically allocated buffer while setting the old object's pointer to `nullptr`.
In the examples below, lines 2 and 4 result in a call to the move assignment 
operator and move constructor.

{% highlight c++ linenos  %}
MyClass c(10);           Constructor 10
c = MyClass(20);         Constructor 20
                         Move assignment operator
MyClass a(MyClass(10));  Constructor 10
                         Move constructor
                         Destructor
                         Destructor
                         Destructor
                         Destructor
{% endhighlight %}

One remark must be made concerning the creation on line 4: here a temporary 
object is created, which is again an rvalue and object `a` is move constructed from it.
This is however not the default behaviour of gcc (version `4.9` in my case). The 
compiler, if not asked otherwise, optimizes away the creation of the temporary.
Something very similar happens with `RVO` (Return Value Optimization) and `NRVO`
(Named return value optimization). `-fno-elide-constructors` will disable this behavior.

Moving from lvalues: std::move and std::forward
=======
Sometimes it becomes necessary to treat `lvalues` as `rvalues`, thus allowing the 
function being invoked to move from a specific argument. `rvalues` can be bound to `rvalue`
references or to `lvalue` references to const. `std::move` carries out the operation of turning an `lvalue`
into an `rvalue`, by returning an `rvalue reference` to its argument, which 
will eventually bind to functions accepting `rvalues` like a move constructor (unless
there is a `const` qualifier involved at some point: in this case, a const rvalue cannot
be passed to a move constructor, which takes a rvalue reverence to a non-const object).
 As `std::move`, `std::forward` is also responsible for casting the argument to an rvalue,
but it does so only if its argument was initialized with an rvalue. The first and foremost scenario 
where `std::forward` comes to play is function templates which take universal references
as arguments.


Universal references and type deduction
=======
Type deduction refers to the operation of statically dispatching a call at compile
time based on the types involved in the invocation. The first and foremost scenario
where the compiler implements type deduction is function templates, which are 
normally declared as follows.

{% highlight c++ linenos  %}
template <typename T> void func(ParamType arg) 
{
    [...]
}
{% endhighlight %}

`ParamType` is basically `T` enriched with qualifiers (e.g. `const`), references,
or pointers. Considering the template function defined above, there are three 
possible scenarios:

  * ParamType is a pointer or a reference, but does not have the form of `T&&`
   (which instead would be a universal reference): in this case the reference part
    of the argument passed to the function can be ignored and *T* deduced 
    consequently.

  * ParamType is a universal reference, i.e. a reference which binds to both
    lvalues and rvalues (which appears as *T&&*). If the argument of the call is 
    an *lvalue*, both *T* and *ParamType* are lvalue references. On the contrary
    if the argument is an *rvalue* the analysis of case 1 applies.

  * ParamType is neither a pointer nor a reference. In this case, the argument
    is passed by value. If the argument is a reference, the reference part can
    be ignored to deduce *T*. *arg* is copy constructed and therefore independent
    of any additional qualifier like *const* or *volatile* (unless, in case of
    a pointer, *const* refers to the data being pointed to).


If *T* is deduced to be of type lvalue reference, the compiler will perform reference
collapsing to derive the final type of *ParamType*: if any of the right hand side or
left hand side are lvalue references, the result is an `lvalue` reference. Otherwise,
the result is an `rvalue` reference.
