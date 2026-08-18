// Alpha Deluxe 7 — shared interactions

document.addEventListener("DOMContentLoaded", function () {
  // Mobile nav toggle
  var toggle = document.querySelector(".nav-toggle");
  var mobileNav = document.querySelector(".mobile-nav");
  if (toggle && mobileNav) {
    toggle.addEventListener("click", function () {
      mobileNav.classList.toggle("open");
    });
    mobileNav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        mobileNav.classList.remove("open");
      });
    });
  }

  // Scroll-reveal animations
  var revealEls = document.querySelectorAll(".reveal, .reveal-stagger");
  if (revealEls.length && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  // FAQ accordion
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var q = item.querySelector(".faq-q");
    if (!q) return;
    q.addEventListener("click", function () {
      var wasOpen = item.classList.contains("open");
      item.closest(".faq-list").querySelectorAll(".faq-item").forEach(function (i) {
        i.classList.remove("open");
        i.querySelector(".faq-q").setAttribute("aria-expanded", "false");
      });
      if (!wasOpen) {
        item.classList.add("open");
        q.setAttribute("aria-expanded", "true");
      }
    });
  });

  // Service tabs
  var tabBtns = document.querySelectorAll(".tab-btn");
  if (tabBtns.length) {
    tabBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = btn.getAttribute("data-tab");
        document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
        document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        document.getElementById(target).classList.add("active");
        history.replaceState(null, "", "#" + target);
      });
    });
    // open tab from URL hash on load
    var hash = window.location.hash.replace("#", "");
    if (hash && document.getElementById(hash)) {
      var targetBtn = document.querySelector('.tab-btn[data-tab="' + hash + '"]');
      if (targetBtn) targetBtn.click();
    }
  }

  // Contact form -> builds a prefilled WhatsApp message (static site, no backend)
  var form = document.getElementById("contact-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nome = document.getElementById("f-nome").value.trim();
      var servico = document.getElementById("f-servico").value;
      var mensagem = document.getElementById("f-mensagem").value.trim();

      var texto = "Olá! Meu nome é " + nome + ".";
      if (servico) texto += " Tenho interesse em: " + servico + ".";
      if (mensagem) texto += " " + mensagem;

      var url = "https://wa.me/5531997220719?text=" + encodeURIComponent(texto);
      window.open(url, "_blank");
    });
  }
});
