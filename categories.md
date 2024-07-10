---
layout: page
permalink: /categories/
title: Categories
hidden: true
---

<div id="archives">
<ul>
{% assign sortedcategories = site.categories | sort %}
{% for category in sortedcategories %}
  <div class="archive-group">
    {% capture category_name %}{{ category | first }}{% endcapture %}
    <li>

    <a name="{{ category_name  }}" href="/categories/{{category_name | downcase}}">{{category_name}}</a></li>
  </div>
{% endfor %}
</ul>
</div>
