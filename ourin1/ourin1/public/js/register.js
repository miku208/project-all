const $ = (id) => document.getElementById(id);

document.querySelectorAll("[data-toggle-for]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = $(btn.dataset.toggleFor);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "Lihat" : "Sembunyi";
  });
});

if (localStorage.getItem("jadibot_token")) {
  const user = App.currentUser();
  location.href = user && user.role === "admin" ? "admin.html" : "dashboard.html";
}

const form = $("registerForm");
const submitBtn = $("submitBtn");
const errorMsg = $("errorMsg");
const pwInput = $("password");
const strengthBars = document.querySelectorAll("#pwStrength span");

function passwordScore(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

const STRENGTH_COLOR = ["#ff6b6b", "#ff6b6b", "#ffb454", "#37e58c", "#37e58c"];

pwInput.addEventListener("input", () => {
  const score = pwInput.value ? Math.max(1, passwordScore(pwInput.value)) : 0;
  strengthBars.forEach((bar, i) => {
    bar.style.background = i < score ? STRENGTH_COLOR[score] : "var(--border)";
  });
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.textContent = "";

  const email = $("email").value.trim();
  const password = pwInput.value;
  const confirmPassword = $("confirmPassword").value;

  if (!email || !password || !confirmPassword) {
    errorMsg.textContent = "Semua field wajib diisi.";
    return;
  }
  if (password.length < 8) {
    errorMsg.textContent = "Password minimal 8 karakter.";
    return;
  }
  if (password !== confirmPassword) {
    errorMsg.textContent = "Konfirmasi password tidak cocok.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.querySelector(".btn-label").textContent = "Memproses…";

  const res = await App.api("/register", { method: "POST", body: { email, password }, silent: true });

  submitBtn.disabled = false;
  submitBtn.querySelector(".btn-label").textContent = "Daftar";

  if (!res.success) {
    errorMsg.textContent = res.error || "Gagal mendaftar, coba lagi.";
    return;
  }

  App.toast("Akun berhasil dibuat, silakan masuk.", "success");
  setTimeout(() => (location.href = "login.html"), 900);
});
