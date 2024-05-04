---
layout: post
title:  "C++ move semantics and rvalue reference"
date:   2016-11-26 08:00:00
published: yes
tags: [programming, c++]
pygments: true
categories: [Technical]
---

A collection of notes where I have recently tried to consolidate C++11 concepts such as move semantics, rvalue reference and forwarding,
showing how these features affect compile time and runtime behavior of C++ programs. 

Constructor, Copy Constructor and Move Constructor
=======

Let's consider a class with constructor, copy constructor, move constructor,
copy assignment operator and move assignment operator. We'll refer to it as
CopyMoveAssign class, or CMS.

{% highlight c++ linenos %}
class CMS {
public:
  int _value;
  CMS() {
    cout << "Default constructor " << endl;
  }
  CMS(int value) {
    cout << "Constructor " << value <<  endl;
    this->_value = value;
  }
  CMS(CMS &rhs) {
     cout << "Copy constructor" << endl;
     this->_value = rhs._value;
  }
  CMS& operator=(CMS &rhs) {
      cout << "Copy assignment operator" << endl;
      this->_value = rhs._value;
      return *this;
  }
  CMS& operator=(CMS &&rhs) {
      cout << "Move assignment operator" << endl;
      this->_value = rhs._value;
      rhs._value = -1;
      return *this;
  }
  CMS(CMS &&rhs) {
      cout << "Move constructor" << endl;
      this->_value = rhs._value;
      rhs._value = -1;
  }
  ~CMS() {
      cout << "Destructor" << endl;
   }
};
{% endhighlight %}

Some first basic construction scenarios are shown below, with the code on the 
left and the output on the right.

{% highlight c++ linenos %}
CMS cms1(10);     Constructor 10
CMS cms2(cms1);   Copy constructor
cms2 = cms1;      Copy assignment operator
CMS cms3 = cms2;  Copy constructor
                  Destructor
                  Destructor
                  Destructor
{% endhighlight %}

These examples are all well known under C++98. It's worth pointing
out is the invocation of the copy constructor on line 2 and 4.
\\
\\
In the context of C++11, the introduction of rvalue references allows to implement
move semantics: when constructing an object from a reference to an rvalue, the code
can transfer ownership of resources from that argument to the object being constructed, 
with the awareness that the original one needs to be left in a consistent state but 
the caller will not expect it to hold an initialized value anymore. As a matter
of fact, with a proper rvalue, the caller will not even be able to tell if the object
has been modified or not, due to the temporary nature of rvalues. 
\\
\\
A simplified example of move semantics is implemented by the move constructor
of `CMS` class. The old object loses ownership of a certain resource while still
being left in a consistent state. In this case there is solely an integer value 
moved around: a more meaningful example would involve transferring ownership of a 
dynamically allocated buffer while setting the old object's pointer to `nullptr`.
In the examples below, lines 2 and 4 result in a call to the move assignment 
operator and move constructor.

{% highlight c++ linenos  %}
CMS cms1(10);       Constructor 10
cms1 = CMS(20);     Constructor 20
                    Move assignment operator
                    Destructor
CMS cms2(CMS(10));  Constructor 10
                    Move constructor
                    Destructor
                    Destructor
{% endhighlight %}

On line 5, a temporary 
object is created, which is again an rvalue and object `cms2` is move constructed from it.
This is however not the default behaviour of gcc (version `4.9` in my case). The 
compiler, if not asked otherwise, optimizes away the creation of the temporary.
Something very similar happens with `RVO` (Return Value Optimization) and `NRVO`
(Named return value optimization). `-fno-elide-constructors` will disable this behavior.

Moving from lvalues: std::move and std::forward
=======
Sometimes it becomes necessary to treat `lvalues` as `rvalues`, thus allowing the 
function being invoked to move from a specific argument. 
\\
\\
`rvalues` can be bound to `rvalue` references or to `lvalue` references to const
as in the following code.


{% highlight c++ linenos  %}
// fRvalueRef takes rvalue reference
void fRvalueRef(CMS&& cms) {
    cout << cms._value << endl;
}

// fLvalueRefConst takes lvalue reference to const
void fLvalueRefConst(CMS const &cms) {
    cout << cms._value << endl;
}

int main() {
    fRvalueRef(CMS(10));
    fLvalueRefConst(CMS(10));
}
{% endhighlight %}

It is not possible to bind a non-const `lvalue` reference to an `rvalue`. Calling mutable methods 
on a temporary object is considered illegal as it's probably a logic bug. The following 
code:
{% highlight c++ linenos  %}
void fLvalueRef(CMS &cms) {
    cout << cms._value << endl;
}

int main() {
    fLvalueRef(CMS(10));
}
{% endhighlight %}

will not compile:

{% highlight text  %}
$ g++ main.cpp -o main -fno-elide-constructors
main.cpp: In function ‘int main()’:
main.cpp:44:16: error: cannot bind non-const lvalue reference of type ‘CMS&’ to an rvalue of type ‘CMS’
   44 |     fLvalueRef(CMS(10));
      |                ^~~~~~~
main.cpp:39:22: note:   initializing argument 1 of ‘void fLvalueRef(CMS&)’
   39 | void fLvalueRef(CMS &cms) {
      |                 ~~~~~^~~

{% endhighlight %}

A const reference to `lvalue` (i.e. CMS& const) points to non-const object, therefore
this configuration is also not allowed. It is however possible to bind a `lvalue` reference 
to const to an `rvalue`, as it is guaranteed that no change will be applied to the temporary object:

{% highlight c++ linenos  %}
// fLvalueRefConst takes a lvalue reference to const
void fLvalueRefConst(const CMS& cms) {
    cout << cms._value << endl;
}

int main() {
    CMS cms(10);
    fLvalueRefConst(std::move(cms));
    cout << cms._value << endl;
}
{% endhighlight %}


`std::move` carries out the operation of turning an `lvalue` into an `rvalue`, 
by returning an `rvalue reference` to its argument, which will eventually bind 
according to the rules above. An `rvalue reference` cannot  bind to an `lvalue`:
when working with an `rvalue`, we assume we fully understand the scope of the
object and that it won't survive past that, which is not the case for an `lvalue`.
The following code:

{% highlight c++ linenos %}
void fRvalueRef(CMS&& cms) {    
    cout << cms._value << endl;
}

int main() {
    CMS cms(10);
    fRvalueRef(cms);
}  
{% endhighlight %}

will not compile:

{% highlight text  %}
$ g++ main.cpp -o main -fno-elide-constructors
main.cpp: In function ‘int main()’:
main.cpp:44:16: error: cannot bind rvalue reference of type ‘CMS&&’ to lvalue of type ‘CMS’
   44 |     fRvalueRef(cms);
      |                ^~~
main.cpp:38:23: note:   initializing argument 1 of ‘void fRvalueRef(CMS&&)’
   38 | void fRvalueRef(CMS&& cms) {
      |
{% endhighlight %}

`std::move` can be used to turn the `lvalue` into and `rvalue`. The reference argument of
`fRvalueRef` will then bind to it:

{% highlight c++ linenos  %}
void fRvalueRef(CMS&& cms) {    
    cout << cms._value << endl;
}

int main() {
    CMS cms(10);
    fRvalueRef(std::move(cms));
}
{% endhighlight %}

`std::move` tells the compiler that the object is eligible to be moved from and 
that we don't care anymore about it holding an
initialized value. If that object can be used to construct more efficiently a copy, by
moving from the object itself, the compiler will do so. In the following code, instead of
copy constructing the argument to `fRvalueRef`, it is move constructed, and the original object
will later hold a non-initialized value:

{% highlight c++ linenos  %}
void fLvalue(CMS cms) {  
    cout << cms._value << endl;
}

int main() {
    CMS cms(10);
    fLvalue(std::move(cms));
    cout << cms._value << endl;
}
{% endhighlight %}

The result is the following:

{% highlight text  %}
Constructor 10
Move constructor
10
Destructor
-1
Destructor
{% endhighlight %}

As `std::move`, `std::forward` is also responsible for casting the argument to an rvalue,
but it does so only if its argument was initialized with an rvalue. `std::forward`` is normally
used with function templates taking forwarding references (`T&&`). For example, consider the following
template function:

{% highlight c++ linenos  %}
void fLvalue(CMS cms) {
    cout << cms._value << endl;
}

template<typename T> void fUniversalRef(T&& param) {
    fLvalue(param);
}

int main() {
    CMS cms(10);
    fUniversalRef(cms);
    cout << cms._value << endl;
}
{% endhighlight %}

On invocation of `fLvalue`, the argument will be copy constructed. We could explicitly ask for it 
to be move constructured by invoking `fLvalue(std::move(param))`. This would work, but `param`
is an `lvalue` reference (`T&&` is a forwarding reference, which follow specific rules for
type deducation), therefore the initial `cms` object would be moved from, and would be invalid
at the end of `main`. This is accepted, as `fUniversalRef` doesn't give any guarantee on the const-ness
for `param`. The following code:


{% highlight c++ linenos  %}
void fLvalue(CMS cms) {
    cout << cms._value << endl;
}

template<typename T> void fUniversalRef(T&& param) {
    fLvalue(std::move(param));
}   
        
int main() {
    CMS cms(10);
    fUniversalRef(cms);
    cout << cms._value << endl;
}

{% endhighlight %}

would result in:

{% highlight text  %}
Constructor 10
Move constructor
10
Destructor
-1
Destructor
{% endhighlight %}


`fUniversalRef` could decide to move from `param` only if it was initially an `rvalue` with `std::forward`.
The following call would therefore result in calling the copy constructor:

{% highlight c++ linenos  %}
void fLvalue(CMS cms) {
    cout << cms._value << endl;
}

template<typename T> void func(T&& param) {
    fLvalue(std::forward<T>(param));
}

int main() {
    CMS cms(10);
    func(cms);
    cout << cms._value << endl;
}
{% endhighlight %}

It's sufficient to cast `cms` to an `rvalue` when invoking `func`, to make `std::forward`
cast `param` to an `rvalue` as well, invoking the move constructor.

