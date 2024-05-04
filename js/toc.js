function installListener() {
    var selector = document.querySelector(".post-content")
    if (selector == null) {
        console.log("selector is null");
        return;
    }
    var headings = selector.querySelectorAll("h1, h2, h3, h4, h5, h6");
    console.log(headings);
    
    window.addEventListener('scroll', function (event) {
      var menuContent =  document.querySelector("#toc");
      var lastActive = document.querySelector('.toc-active');
      var changed = true;
      var activeIndex = -1;
      for (var i = headings.length - 1; i >= 0; i--) {
        var h = headings[i];
        var headingRect = h.getBoundingClientRect();
        
        var header = document.querySelector('.site-header');
        var headerRect = header.getBoundingClientRect();

        var headerTop = Math.floor(headerRect.top);
        var headerHeight = Math.floor(headerRect.height);
        var headerHeight = headerHeight + 20;
        if (headingRect.top <= headerHeight) {
          var id = h.getAttribute('id');
          var a = menuContent.querySelector('a[href="#' + id  + '"]');
          var curActive = a.parentNode;
          if (curActive) {
            curActive.classList.add('toc-active');
            activeIndex = i;
          }
          if (lastActive == curActive) {
            changed = false;
          }
          break;
        }
      }
      if (changed) {
        if (lastActive) {
          lastActive.classList.remove('toc-active');
        }
      }
      event.preventDefault();
    });
}

document.addEventListener("DOMContentLoaded", function() { 
    installListener();
});
