const $ = (id) => document.getElementById(id);

document.querySelectorAll("[data-toggle-for]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = $(btn.dataset.toggleFor);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "Lihat" : "Sembunyi";
  });
});

const form = $("loginForm");
const submitBtn = $("submitBtn");
const errorMsg = $("errorMsg");

// kalau sudah login, langsung lempar ke dashboard yang sesuai
if (localStorage.getItem("jadibot_token")) {
  const user = App.currentUser();
  location.href = user && user.role === "admin" ? "admin.html" : "dashboard.html";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.textContent = "";

  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || !password) {
    errorMsg.textContent = "Isi email dan password dulu, ya.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.querySelector(".btn-label").textContent = "Memproses…";

  const res = await App.api("/login", { method: "POST", body: { email, password }, silent: true });

  submitBtn.disabled = false;
  submitBtn.querySelector(".btn-label").textContent = "Masuk";

  if (!res.success) {
    errorMsg.textContent = res.error || "Email atau password salah.";
    return;
  }

  App.setSession(res.token, res.user);
  App.toast("Berhasil masuk.", "success");
  location.href = res.user.role === "admin" ? "admin.html" : "dashboard.html";
});
