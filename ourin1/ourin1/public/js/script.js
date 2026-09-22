const $ = (id) => document.getElementById(id);

const stepInput = $("stepInput");
const stepCode = $("stepCode");
const stepDone = $("stepDone");
const dot = $("dot");
const dotLabel = $("dotLabel");
const numberInput = $("number");
const submitBtn = $("submitBtn");
const errorMsg = $("errorMsg");
const codeRow = $("codeRow");
const copyBtn = $("copyBtn");
const cancelBtn = $("cancelBtn");
const stopBtn = $("stopBtn");
const doneText = $("doneText");

let currentNumber = null;
let currentCode = null;
let pollTimer = null;

function setStatus(state, label) {
  dot.className = "dot" + (state ? ` ${state}` : "");
  dotLabel.textContent = label;
}

function showStep(step) {
  [stepInput, stepCode, stepDone].forEach((s) => s.classList.add("hidden"));
  step.classList.remove("hidden");
}

function renderCode(code) {
  codeRow.innerHTML = "";
  for (const ch of code) {
    const box = document.createElement("div");
    if (ch === "-") {
      box.className = "code-digit dash";
      box.textContent = "—";
    } else {
      box.className = "code-digit";
      box.textContent = ch;
    }
    codeRow.appendChild(box);
  }
}

async function submitNumber() {
  const raw = numberInput.value.trim();
  errorMsg.textContent = "";

  if (!raw) {
    errorMsg.textContent = "Isi nomor dulu, ya.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.querySelector(".btn-label").textContent = "Memproses…";
  setStatus("active", "menghubungkan");

  try {
    const res = await fetch("/api/jadibot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: raw }),
    });
    const data = await res.json();

    if (!data.success) {
      errorMsg.textContent = data.error || "Gagal memproses nomor.";
      setStatus("error", "gagal");
      return;
    }

    currentNumber = data.id;
    currentCode = data.pairingCode;
    renderCode(currentCode);
    setStatus("active", "menunggu ditautkan");
    showStep(stepCode);
    startPolling();
  } catch {
    errorMsg.textContent = "Tidak bisa menghubungi server.";
    setStatus("error", "gagal");
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector(".btn-label").textContent = "Jadi Bot";
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!currentNumber) return;
    try {
      const res = await fetch(`/api/jadibot/${currentNumber}/status`);
      const data = await res.json();
      if (data.success && data.status === "connected") {
        stopPolling();
        doneText.textContent = `Nomor +${currentNumber} sekarang aktif jadi bot.`;
        setStatus("active", "terhubung");
        showStep(stepDone);
      }
    } catch {
      // biarin, coba lagi di tick berikutnya
    }
  }, 3000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function resetToStart() {
  stopPolling();
  currentNumber = null;
  currentCode = null;
  numberInput.value = "";
  errorMsg.textContent = "";
  setStatus(null, "menunggu nomor");
  showStep(stepInput);
}

submitBtn.addEventListener("click", submitNumber);
numberInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitNumber();
});

copyBtn.addEventListener("click", async () => {
  if (!currentCode) return;
  try {
    await navigator.clipboard.writeText(currentCode.replace(/-/g, ""));
    copyBtn.textContent = "Tersalin ✓";
    setTimeout(() => (copyBtn.textContent = "Salin kode"), 1500);
  } catch {
    copyBtn.textContent = "Gagal menyalin";
  }
});

cancelBtn.addEventListener("click", resetToStart);

stopBtn.addEventListener("click", async () => {
  if (!currentNumber) return resetToStart();
  stopBtn.disabled = true;
  try {
    await fetch(`/api/jadibot/${currentNumber}/stop`, { method: "POST" });
  } catch {
    // tetap balik ke awal walau request stop gagal
  }
  stopBtn.disabled = false;
  resetToStart();
});