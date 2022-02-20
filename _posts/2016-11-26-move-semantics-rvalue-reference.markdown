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
      return this;
  }
  MyClass& operator=(MyClass &&rhs) {
      cout << "Move assignment operator" << endl;
      this->_value = rhs._value;
      rhs._value = -1;
      return *this;
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

On line 4, a temporary 
object is created, which is again an rvalue and object `a` is move constructed from it.
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
// func takes rvalue reference
void func(MyClass&& a) {
    cout << a._value << endl;
}

// func1 takes lvalue reference to const
void func1(MyClass const &a) {
    cout << a._value << endl;
}

int main() {
    func(MyClass(10));
    func1(MyClass(10));
}
{% endhighlight %}

It is not possible to bind a non-const `lvalue` reference to an `rvalue`. Calling mutable methods 
on a temporary object is considered illegal as it's probably a logic bug. The following 
code:
{% highlight c++ linenos  %}
void func(MyClass &a) {
    cout << a._value << endl;
}

int main() {
    func(MyClass(10));
}
{% endhighlight %}

will not compile:

{% highlight text  %}
$ g++ main.cpp -o main -fno-elide-constructors
main.cpp: In function ‘int main()’:
main.cpp:43:10: error: cannot bind non-const lvalue reference of type ‘MyClass&’ to an rvalue of type ‘MyClass’
   43 |     func(MyClass(10));
      |

{% endhighlight %}

It is however possible to bind a const `lvalue` reference to an `rvalue`, as it is 
guaranteed that no change will be applied to the temporary object:

{% highlight c++ linenos  %}
// func takes a const lvalue reference
void func(const MyClass& a) {
    cout << a._value << endl;
}

int main() {
    MyClass a(10);
    func(std::move(a));
    cout << a._value << endl;
}
{% endhighlight %}



`std::move` carries out the operation of turning an `lvalue` into an `rvalue`, 
by returning an `rvalue reference` to its argument, which will eventually bind 
according to the rules above. An `rvalue reference` cannot  bind to an `lvalue`. 
The following code:

{% highlight c++ linenos %}
void func(MyClass&& a) {    
    cout << a._value << endl;
}

int main() {
    MyClass a(10);
    func(a);
}  
{% endhighlight %}

will not compile:

{% highlight text  %}
$ g++ main.cpp -o main -fno-elide-constructors
main.cpp: In function ‘int main()’:
main.cpp:47:10: error: cannot bind rvalue reference of type ‘MyClass&&’ to lvalue of type ‘MyClass’
   47 |     func(a);
      |
{% endhighlight %}

`std::move` can be used to turn the `lvalue` into and `rvalue`. The reference argument of
`func` will then bind to it:

{% highlight c++ linenos  %}
void func(MyClass&& a) {    
    cout << a._value << endl;
}

int main() {
    MyClass a(10);
    func(std::move(a));
}
{% endhighlight %}

`std::move` tells the compiler that the object is eligible to be moved from  and 
that we don't care anymore about it holding an
initialized value. If that object can be used to construct more efficiently a copy, by
moving from the object itself, the compiler will do so. In the following code, instead of
copy constructing the argument to `func`, it is move constructed, and the original object
will later hold a non-initialized value:

{% highlight c++ linenos  %}
void func(MyClass a) {  
    cout << a._value << endl;
}

int main() {
    MyClass a(10);
    func(std::move(a));
    cout << a._value << endl;
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
used with function templates taking universal referececes. For example, consider the following
template function:

{% highlight c++ linenos  %}
void func1(MyClass a) {
    cout << a._value << endl;
}

template<typename T> void func(T&& param) {
    func1(param);
}

int main() {
    MyClass a(10);
    func(a);
    cout << a._value << endl;
}
{% endhighlight %}

On invocation of `func`, the argument will be copy constructed. We could explicitly ask for it 
to be move constructured by invoking `func1(std::move(param))`. This would work, but `param`
is an `lvalue` reference (`T&&` is a universal reference, which follow specific rules for
type deducation), therefore the initial `a` object would be moved from, and would be invalid
at the end of `main`. This is accepted, as `func` doesn't give any guarantee on the const-ness
for `param`.

`func` could decide to move from `param` only if it was initially an `rvalue` with `std::forward`.
The following call would therefore result in calling the copy constructor:

{% highlight c++ linenos  %}
void func1(MyClass a) {
    cout << a._value << endl;
}

template<typename T> void func(T&& param) {
    func1(std::forward<T>(param));
}

int main() {
    MyClass a(10);
    func(a);
    cout << a._value << endl;
}
{% endhighlight %}

It's sufficient to cast `a` to an `rvalue` when invoking `func`, that `std::forward` will
cast `param` to an `rvalue` as well, invoking the move constructor.

{% comment %}
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
{% endcomment %}
