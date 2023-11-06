function clickDarkLightBtn() {
    toggleTheme();
    applyTheme();
}

function setThemeIfNull() {
    let currentThemeSetting = localStorage.getItem("theme");
    if (currentThemeSetting == null) {
        currentThemeSetting = "dark"
    }

    localStorage.setItem("theme", currentThemeSetting);
}

function toggleTheme() {
    let currentThemeSetting = localStorage.getItem("theme");
    if (currentThemeSetting == "dark") {
        currentThemeSetting = "light";
    } else {
        currentThemeSetting = "dark";
    }
    localStorage.setItem("theme", currentThemeSetting);
}


function addRemove(addClasses, removeClasses, firstClass, defaultClass) {
    var all = Array.from(document.getElementsByClassName(firstClass)).concat(Array.from(document.getElementsByClassName(defaultClass)));
    for (var i = 0; i < all.length; i++) {
        all[i].classList.remove(defaultClass);
        for (var c = 0; c < removeClasses.length; c++) {
            all[i].classList.remove(removeClasses[c]);
        }
        for (var c = 0; c < addClasses.length; c++) {
            all[i].classList.add(addClasses[c]);
        }
    }

}

function applyClassesToElements(theme) {
    if (theme == "dark") {
        /* Add hide for light elements */
        addRemove(["light-element", "hide-button"], "", "light-element", "light-element-default");
        /* Remove hide for dark elements */
        addRemove(["dark-element"], ["hide-button"], "dark-element", "dark-element-default");
    } else {
        addRemove(["dark-element", "hide-button"], [], "dark-element", "dark-element-default");
        /* Remove hide for light elements */
        addRemove(["light-element"], ["hide-button"], "light-element", "light-element-default");
    }

}

function applyTheme() {
    let currentThemeSetting = localStorage.getItem("theme");

    var r = document.querySelector(':root');

    if (currentThemeSetting == "dark") {
        r.classList.add('is-dark-mode')

        if (document.readyState === "complete") {
            applyClassesToElements("dark")
        } else {
            window.addEventListener("DOMContentLoaded", function() {
                applyClassesToElements("dark")
            }, false);
        }
    } else {
        r.classList.remove('is-dark-mode')
        if (document.readyState === "complete") {
            applyClassesToElements("light")
        } else {
            window.addEventListener("DOMContentLoaded", function() {
                applyClassesToElements("light")
            }, false);
        }
    }
}
