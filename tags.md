---
layout: page
permalink: /tags/
title: Tags
---

<div id="archives">
<ul>
{% assign sortedtags = site.tags | sort %}
{% for tag in sortedtags %}
  <div class="archive-group">
    {% capture tag_name %}{{ tag | first }}{% endcapture %}
    <li>

    <a name="{{ tag_name | slugize }}" href="/tags/{{tag_name}}">{{tag_name}}</a></li>
  </div>
{% endfor %}
</ul>
</div>
