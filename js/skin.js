function clickDarkLightBtn() {
    toggleTheme();
}


function apply() {

    let currentThemeSetting = localStorage.getItem("theme");

    var r = document.querySelector(':root');

    if (currentThemeSetting == "dark") {
        r.classList.add('is-dark-mode');
    } else{
        r.classList.remove('is-dark-mode');
    }
}


function setThemeIfNull() {
    let currentThemeSetting = localStorage.getItem("theme");
    if (currentThemeSetting == null) {
        currentThemeSetting = "dark"
    }

    localStorage.setItem("theme", currentThemeSetting);
    document.documentElement.setAttribute('data-theme', currentThemeSetting);
    apply();
}

function toggleTheme() {
    let currentThemeSetting = localStorage.getItem("theme");
    if (currentThemeSetting == "dark") {
        currentThemeSetting = "light";
    } else {
        currentThemeSetting = "dark";
    }
    localStorage.setItem("theme", currentThemeSetting);
    console.log("setting attr");
    document.documentElement.setAttribute('data-theme', currentThemeSetting);
    apply();
}
