const API_BASE = new URLSearchParams(window.location.search).get("api") || "http://localhost:5192/api";

let currentUser = null;
let currentToken = null;
let selectedSlot = null;
let availableSlots = [];
let branchCache = [];
let staffCache = [];
let serviceCache = [];
let appointmentCache = [];
let reschedulingAppointmentId = null;

// Initial Setup
document.addEventListener("DOMContentLoaded", () => {
    // Set default date picker to next Monday
    const today = new Date();
    const resultDate = new Date(today);
    resultDate.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7 || 7)); // Next Monday
    const year = resultDate.getFullYear();
    const month = String(resultDate.getMonth() + 1).padStart(2, '0');
    const day = String(resultDate.getDate()).padStart(2, '0');
    document.getElementById("dateInput").value = `${year}-${month}-${day}`;

    // Auto login if token exists in localStorage
    const savedToken = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user");
    if (savedToken && savedUser) {
        currentToken = savedToken;
        currentUser = JSON.parse(savedUser);
        showDashboard();
    } else {
        loadBranches();
    }
});

// UI Views Switcher
function showDashboard() {
    document.getElementById("loginView").style.display = "none";
    document.getElementById("dashboardView").style.display = "block";
    document.getElementById("userNav").style.display = "flex";

    function getRoleName(roleId) {
        switch(parseInt(roleId)) {
            case 0: return "Yönetici";
            case 1: return "Müdür";
            case 2: return "Personel";
            case 3: return "Müşteri";
            default: return "Kullanıcı";
        }
    }

    document.getElementById("userNameDisplay").textContent = currentUser.name;
    document.getElementById("userRoleDisplay").textContent = getRoleName(currentUser.role);

    const bookingPanel = document.getElementById("bookingPanel");
    if (bookingPanel) bookingPanel.style.display = Number(currentUser.role) === 3 ? "" : "none";

    const appointmentsTitle = document.querySelector("#appointmentsTitle span");
    if (appointmentsTitle) {
        appointmentsTitle.textContent = Number(currentUser.role) === 3
            ? "Aktif Randevularım & Geçmiş"
            : "Yetkili Randevu Yönetimi";
    }

    loadBranches();
    loadMyAppointments();
}

function showLogin() {
    document.getElementById("loginView").style.display = "block";
    document.getElementById("dashboardView").style.display = "none";
    document.getElementById("userNav").style.display = "none";
    loadBranches();
}

// Tab Switching logic
function switchAuthTab(tab) {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const tabLoginBtn = document.getElementById("tabLoginBtn");
    const tabRegisterBtn = document.getElementById("tabRegisterBtn");

    if (tab === 'login') {
        loginForm.style.display = "block";
        registerForm.style.display = "none";
        tabLoginBtn.classList.add("active");
        tabRegisterBtn.classList.remove("active");
    } else {
        loginForm.style.display = "none";
        registerForm.style.display = "block";
        tabLoginBtn.classList.remove("active");
        tabRegisterBtn.classList.add("active");
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatCurrency(value) {
    const amount = Number(value ?? 0);
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        minimumFractionDigits: 2
    }).format(amount);
}

function formatDuration(minutes) {
    const totalMinutes = Number(minutes ?? 0);
    if (!totalMinutes) return "Süre bilgisi yok";

    const hours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;

    if (hours && remainingMinutes) return `${hours} sa ${remainingMinutes} dk`;
    if (hours) return `${hours} sa`;
    return `${remainingMinutes} dk`;
}

function formatTime(date) {
    return String(date.getHours()).padStart(2, '0') + ":" + String(date.getMinutes()).padStart(2, '0');
}

function getStatusText(status) {
    const statusMap = {
        Pending: "Onay bekliyor",
        Approved: "Onaylandı",
        Cancelled: "İptal edildi"
    };

    return statusMap[status] || "Durum bilgisi yok";
}

function getSelectedBranch() {
    const branchId = Number(document.getElementById("branchSelect")?.value);
    return branchCache.find(branch => branch.id === branchId);
}

function getSelectedService() {
    const serviceId = Number(document.getElementById("serviceSelect")?.value);
    return serviceCache.find(service => service.id === serviceId);
}

function getSelectedStaffMember() {
    const employeeId = Number(document.getElementById("employeeSelect")?.value);
    return staffCache.find(staff => staff.id === employeeId);
}

function getDateLabel(dateValue) {
    if (!dateValue) return "Tarih seçilmedi";
    return new Date(`${dateValue}T12:00:00`).toLocaleDateString("tr-TR", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function setDateShortcut(daysFromToday) {
    const dateInput = document.getElementById("dateInput");
    if (!dateInput) return;

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysFromToday);
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    dateInput.value = `${year}-${month}-${day}`;
    loadSlots();
}

function updateBookingSummary() {
    const summary = document.getElementById("bookingSummary");
    if (!summary) return;

    const branch = getSelectedBranch();
    const service = getSelectedService();
    const staff = getSelectedStaffMember();
    const dateValue = document.getElementById("dateInput")?.value;

    if (!branch || !service || !staff || !dateValue) {
        summary.innerHTML = "Şube, hizmet, uzman ve tarih seçildiğinde randevu ön değerlendirmesi burada görüntülenir.";
        return;
    }

    let slotLine = "Saat seçildiğinde tahmini bitiş saati otomatik hesaplanır.";
    let readinessLine = "Hazırlık durumu: saat seçimi bekleniyor.";
    if (selectedSlot) {
        const startDate = new Date(selectedSlot);
        const endDate = new Date(startDate.getTime() + Number(service.durationMinutes) * 60000);
        slotLine = `Seçilen saat: ${formatTime(startDate)} - ${formatTime(endDate)} arası planlandı.`;
        readinessLine = "Hazırlık durumu: randevu rezervasyona hazır.";
    }

    summary.innerHTML = `
        <div class="app-info">
            <span class="app-service">Randevu Özeti</span>
            <span class="app-meta"><b>${escapeHtml(service.name)}</b> (${formatDuration(service.durationMinutes)}, ${formatCurrency(service.price)})</span>
            <span class="app-meta">Uzman: ${escapeHtml(staff.name)} | Tarih: ${getDateLabel(dateValue)}</span>
            <span class="app-time" style="margin-top: 0.25rem;">${slotLine}</span>
        </div>
    `;
}

function updateServiceProfile() {
    const profile = document.getElementById("serviceProfile");
    if (!profile) return;

    const branch = getSelectedBranch();
    const service = getSelectedService();
    const staff = getSelectedStaffMember();

    if (!branch || !service || !staff) {
        profile.innerHTML = "Hizmet ve şube seçimi yapıldığında operasyon profili burada görüntülenir.";
        return;
    }

    const slotCount = availableSlots.length;
    const capacityText = slotCount
        ? `${slotCount} uygun başlangıç saati bulundu.`
        : "Uygun saatler hesaplanıyor veya seçili gün için kapasite bulunmuyor.";
    const duration = Number(service.durationMinutes || 0);
    const preparationWindow = duration >= 90 ? "Detaylı işlem hazırlığı önerilir." : "Standart işlem hazırlığı yeterlidir.";

    profile.innerHTML = `
        <div class="app-info">
            <span class="app-service">Hizmet Operasyon Profili</span>
            <span class="app-meta">Şube Lokasyonu: ${escapeHtml(branch.address || branch.name)} | Zaman Dilimi: ${escapeHtml(branch.timezone || "Belirtilmedi")}</span>
            <span class="app-meta">Hizmet Planı: ${escapeHtml(service.name)} | Süre Bloku: ${formatDuration(service.durationMinutes)} | Liste Ücreti: ${formatCurrency(service.price)}</span>
            <span class="app-meta">Atanan Uzman: ${escapeHtml(staff.name)} | Kapasite: ${capacityText}</span>
            <span class="app-meta">Hazırlık Standardı: ${preparationWindow} Randevu bitişi hizmet süresine göre otomatik hesaplanır.</span>
            <span class="app-meta">Yönetim Notu: Bu panel, müşteriye net beklenti; ekibe operasyonel hazırlık bilgisi verir.</span>
        </div>
    `;
}

function updateQualityChecklist() {
    const checklist = document.getElementById("qualityChecklist");
    if (!checklist) return;

    const branch = getSelectedBranch();
    const service = getSelectedService();
    const staff = getSelectedStaffMember();
    const dateValue = document.getElementById("dateInput")?.value;

    if (!branch || !service || !staff || !dateValue) {
        checklist.innerHTML = "Randevu kalite kontrol listesi seçimlerden sonra hazırlanır.";
        return;
    }

    const duration = Number(service.durationMinutes || 0);
    const preparationLevel = duration >= 90 ? "Detaylı hazırlık" : "Standart hazırlık";
    const capacityStatus = availableSlots.length > 0 ? "Müsaitlik doğrulandı" : "Müsaitlik bekleniyor";
    const selectedStatus = selectedSlot ? "Saat seçimi tamamlandı" : "Saat seçimi bekleniyor";

    checklist.innerHTML = `
        <div class="app-info">
            <span class="app-service">Randevu Kalite Kontrol Listesi</span>
            <span class="app-meta">1. Şube doğrulandı: ${escapeHtml(branch.name)} (${escapeHtml(branch.timezone || "Zaman dilimi yok")})</span>
            <span class="app-meta">2. Uzman atandı: ${escapeHtml(staff.name)} | Hizmet standardı: ${preparationLevel}</span>
            <span class="app-meta">3. Kapasite kontrolü: ${capacityStatus} | ${availableSlots.length} slot izleniyor.</span>
            <span class="app-meta">4. Rezervasyon durumu: ${selectedStatus} | Tarih: ${getDateLabel(dateValue)}</span>
            <span class="app-meta">5. Müşteri bilgilendirme: süre, ücret, adres ve hazırlık notu randevu kartında gösterilir.</span>
        </div>
    `;
}

function updateServicePolicy() {
    const policy = document.getElementById("servicePolicy");
    if (!policy) return;

    const branch = getSelectedBranch();
    const service = getSelectedService();
    const staff = getSelectedStaffMember();

    if (!branch || !service || !staff) {
        policy.innerHTML = "Hizmet politikası ve müşteri bilgilendirme standardı seçimlerden sonra hazırlanır.";
        return;
    }

    const duration = Number(service.durationMinutes || 0);
    const arrivalText = duration >= 90
        ? "Detaylı hizmetler için randevudan 15 dakika önce şubede olunması önerilir."
        : "Standart hizmetler için randevudan 10 dakika önce şubede olunması önerilir.";
    const continuityText = availableSlots.length > 5
        ? "Seçili gün kapasitesi dengeli görünüyor."
        : "Seçili gün kapasitesi sınırlı; erken rezervasyon önerilir.";

    policy.innerHTML = `
        <div class="app-info">
            <span class="app-service">Hizmet Politikası ve Bilgilendirme Standardı</span>
            <span class="app-meta">Müşteri Şeffaflığı: hizmet adı, uzman, adres, süre ve ücret rezervasyon öncesinde gösterilir.</span>
            <span class="app-meta">Zaman Yönetimi: ${arrivalText}</span>
            <span class="app-meta">Kapasite Uyarısı: ${continuityText}</span>
            <span class="app-meta">Operasyon Standardı: iptal kayıtları geçmişte korunur, aktif kayıtlar raporlama araçlarına dahil edilir.</span>
            <span class="app-meta">Sorumlu Şube: ${escapeHtml(branch.name)} | Uzman: ${escapeHtml(staff.name)}</span>
        </div>
    `;
}

function buildBookingBriefing() {
    const branch = getSelectedBranch();
    const service = getSelectedService();
    const staff = getSelectedStaffMember();
    const dateValue = document.getElementById("dateInput")?.value;

    if (!branch || !service || !staff || !dateValue) {
        return "";
    }

    const selectedTimeLine = selectedSlot
        ? `Planlanan saat: ${formatTime(new Date(selectedSlot))}`
        : "Planlanan saat: henüz seçilmedi";

    return [
        "AppointmentCore Randevu Brifingi",
        `Şube: ${branch.name}`,
        `Adres: ${branch.address || "Adres bilgisi yok"}`,
        `Hizmet: ${service.name}`,
        `Uzman: ${staff.name}`,
        `Tarih: ${getDateLabel(dateValue)}`,
        selectedTimeLine,
        `Süre: ${formatDuration(service.durationMinutes)}`,
        `Ücret: ${formatCurrency(service.price)}`,
        `Hazırlık: Randevu saatinden önce şubede olunması önerilir.`,
        `Operasyon: Çakışma ve kapasite kontrolü sistem tarafından yapılır.`
    ].join("\n");
}

function updateBookingBriefing() {
    const briefing = document.getElementById("bookingBriefing");
    if (!briefing) return;

    const text = buildBookingBriefing();
    if (!text) {
        briefing.innerHTML = "Müşteri brifingi seçimlerden sonra hazırlanır.";
        return;
    }

    const lines = text.split("\n").slice(1);
    briefing.innerHTML = `
        <div class="app-info">
            <span class="app-service">Müşteri Randevu Brifingi</span>
            ${lines.map(line => `<span class="app-meta">${escapeHtml(line)}</span>`).join("")}
            <span class="app-meta">Kullanım: Bu brifing müşteriye, resepsiyona veya operasyon ekibine tek metin olarak paylaşılabilir.</span>
        </div>
    `;
}

function updateServiceLevelPanel() {
    const panel = document.getElementById("serviceLevelPanel");
    if (!panel) return;

    const branch = getSelectedBranch();
    const service = getSelectedService();
    const staff = getSelectedStaffMember();
    const dateValue = document.getElementById("dateInput")?.value;

    if (!branch || !service || !staff || !dateValue) {
        panel.innerHTML = "Hizmet seviyesi taahhüdü seçimlerden sonra hazırlanır.";
        return;
    }

    const duration = Number(service.durationMinutes || 0);
    const buffer = duration >= 90 ? 15 : 10;
    const capacityLabel = availableSlots.length >= 8
        ? "Yüksek müsaitlik"
        : availableSlots.length >= 3
            ? "Dengeli müsaitlik"
            : "Sınırlı müsaitlik";
    const selectedLabel = selectedSlot ? "Rezervasyona hazır" : "Saat seçimi bekliyor";

    panel.innerHTML = `
        <div class="app-info">
            <span class="app-service">Hizmet Seviyesi Taahhüdü</span>
            <span class="app-meta">Karşılama Standardı: müşteri randevudan ${buffer} dakika önce bilgilendirilir.</span>
            <span class="app-meta">Zaman Taahhüdü: ${formatDuration(service.durationMinutes)} hizmet bloğu ve otomatik bitiş saati hesaplanır.</span>
            <span class="app-meta">Kapasite Sinyali: ${capacityLabel} | ${availableSlots.length} uygun saat izleniyor.</span>
            <span class="app-meta">Rezervasyon Olgunluğu: ${selectedLabel} | Sorumlu uzman: ${escapeHtml(staff.name)}</span>
            <span class="app-meta">Şube Standardı: ${escapeHtml(branch.name)} müşteriye adres, ücret ve hazırlık notunu net sunar.</span>
        </div>
    `;
}

function updateDecisionSupportPanel() {
    const panel = document.getElementById("decisionSupportPanel");
    if (!panel) return;

    const branch = getSelectedBranch();
    const service = getSelectedService();
    const staff = getSelectedStaffMember();
    const dateValue = document.getElementById("dateInput")?.value;

    if (!branch || !service || !staff || !dateValue) {
        panel.innerHTML = "Karar destek özeti seçimlerden sonra hazırlanır.";
        return;
    }

    const duration = Number(service.durationMinutes || 0);
    const valueLevel = Number(service.price || 0) >= 500 ? "Yüksek değerli hizmet" : "Standart değerli hizmet";
    const capacityLevel = availableSlots.length >= 8 ? "rahat kapasite" : availableSlots.length >= 3 ? "kontrollü kapasite" : "sınırlı kapasite";
    const recommendation = selectedSlot
        ? "Rezervasyon tamamlanabilir; müşteri brifingi paylaşılabilir."
        : availableSlots.length
            ? "En erken uygun saat seçilerek rezervasyon hızlandırılabilir."
            : "Alternatif tarih veya uzman değerlendirilmelidir.";

    panel.innerHTML = `
        <div class="app-info">
            <span class="app-service">Karar Destek Özeti</span>
            <span class="app-meta">Hizmet sınıfı: ${valueLevel} | Süre etkisi: ${formatDuration(duration)} | Kapasite: ${capacityLevel}</span>
            <span class="app-meta">Şube/Uzman: ${escapeHtml(branch.name)} / ${escapeHtml(staff.name)} | Tarih: ${getDateLabel(dateValue)}</span>
            <span class="app-meta">Öneri: ${recommendation}</span>
            <span class="app-meta">Profesyonel kullanım: bu özet rezervasyon öncesi son kontrol ve müşteri yönlendirmesi için hazırlanır.</span>
        </div>
    `;
}

function buildCustomerConsentText() {
    const branch = getSelectedBranch();
    const service = getSelectedService();
    const staff = getSelectedStaffMember();
    const dateValue = document.getElementById("dateInput")?.value;

    if (!branch || !service || !staff || !dateValue) return "";

    const timeText = selectedSlot ? formatTime(new Date(selectedSlot)) : "Saat seçimi bekleniyor";
    return [
        "AppointmentCore Müşteri Onay Metni",
        `Seçilen hizmet: ${service.name}`,
        `Şube: ${branch.name} - ${branch.address || "Adres bilgisi yok"}`,
        `Uzman: ${staff.name}`,
        `Tarih/Saat: ${getDateLabel(dateValue)} / ${timeText}`,
        `Süre ve ücret: ${formatDuration(service.durationMinutes)} / ${formatCurrency(service.price)}`,
        "Müşteri, randevu saatinden önce şubede bulunması gerektiği konusunda bilgilendirilmiştir.",
        "Randevu iptal edilirse kayıt geçmişte durum etiketiyle saklanır."
    ].join("\n");
}

function updateCustomerConsentPanel() {
    const panel = document.getElementById("customerConsentPanel");
    if (!panel) return;

    const consent = buildCustomerConsentText();
    if (!consent) {
        panel.innerHTML = "Müşteri onay ve bilgilendirme metni seçimlerden sonra hazırlanır.";
        return;
    }

    panel.innerHTML = `
        <div class="app-info">
            <span class="app-service">Müşteri Onay ve Bilgilendirme Metni</span>
            ${consent.split("\n").slice(1).map(line => `<span class="app-meta">${escapeHtml(line)}</span>`).join("")}
            <span class="app-meta">Kullanım: randevu öncesi müşteri teyidi veya resepsiyon bilgilendirmesi için kopyalanabilir.</span>
        </div>
    `;
}

async function copyCustomerConsentText() {
    const consent = buildCustomerConsentText();
    if (!consent) {
        showToast("Kopyalanacak onay metni için seçimleri tamamlayın.", "error");
        return;
    }

    try {
        await navigator.clipboard.writeText(consent);
        showToast("Onay metni panoya kopyalandı.", "success");
    } catch (err) {
        showToast("Onay metni kopyalanamadı.", "error");
    }
}

async function copyBookingBriefing() {
    const briefing = buildBookingBriefing();
    if (!briefing) {
        showToast("Kopyalanacak randevu brifingi için seçimleri tamamlayın.", "error");
        return;
    }

    try {
        await navigator.clipboard.writeText(briefing);
        showToast("Randevu brifingi panoya kopyalandı.", "success");
    } catch (err) {
        showToast("Randevu brifingi kopyalanamadı.", "error");
    }
}

function updateAppointmentInsights(appointments) {
    const insights = document.getElementById("appointmentInsights");
    if (!insights) return;

    if (!appointments.length) {
        insights.innerHTML = "Henüz analiz edilecek randevu bulunmuyor.";
        return;
    }

    const now = new Date();
    const upcoming = appointments.filter(app => app.status !== "Cancelled" && new Date(app.startTimeUtc) >= now);
    const cancelled = appointments.filter(app => app.status === "Cancelled");
    const completedOrPast = appointments.filter(app => app.status !== "Cancelled" && new Date(app.startTimeUtc) < now);
    const revenue = appointments
        .filter(app => app.status !== "Cancelled")
        .reduce((total, app) => total + Number(app.price ?? app.service?.price ?? 0), 0);
    const approvalRate = appointments.length
        ? Math.round(((appointments.length - cancelled.length) / appointments.length) * 100)
        : 0;
    const nextAppointment = upcoming
        .sort((a, b) => new Date(a.startTimeUtc) - new Date(b.startTimeUtc))[0];
    const nextLine = nextAppointment
        ? `Sıradaki randevu: #${nextAppointment.id} - ${nextAppointment.service?.name || "Hizmet"} (${formatTime(new Date(nextAppointment.startTimeUtc))})`
        : "Sıradaki aktif randevu bulunmuyor.";

    insights.innerHTML = `
        <div class="app-info">
            <span class="app-service">Randevu Portföy Özeti</span>
            <span class="app-meta">Yaklaşan: ${upcoming.length} | Geçmiş/Tamamlanan: ${completedOrPast.length} | İptal: ${cancelled.length}</span>
            <span class="app-meta">Planlanan hizmet değeri: ${formatCurrency(revenue)}</span>
            <span class="app-meta">Aktif kayıt oranı: %${approvalRate} | ${escapeHtml(nextLine)}</span>
            <span class="app-meta">Profesyonel takip: kayıtlar aranabilir, filtrelenebilir, kopyalanabilir ve rapor olarak dışa aktarılabilir.</span>
        </div>
    `;
}

function updateAppointmentStatusBoard(appointments) {
    const board = document.getElementById("appointmentStatusBoard");
    if (!board) return;

    if (!appointments.length) {
        board.innerHTML = "Randevu durum panosu için kayıt bulunmuyor.";
        return;
    }

    const pending = appointments.filter(app => app.status === "Pending").length;
    const approved = appointments.filter(app => app.status === "Approved").length;
    const cancelled = appointments.filter(app => app.status === "Cancelled").length;
    const totalMinutes = appointments
        .filter(app => app.status !== "Cancelled")
        .reduce((total, app) => total + Number(app.service?.durationMinutes || 0), 0);
    const workloadHours = totalMinutes ? (totalMinutes / 60).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "0";

    board.innerHTML = `
        <div class="app-info">
            <span class="app-service">Randevu Durum Panosu</span>
            <span class="app-meta">Onay Bekleyen: ${pending} | Onaylanan: ${approved} | İptal: ${cancelled}</span>
            <span class="app-meta">Planlanan operasyon yükü: ${workloadHours} saat | Toplam kayıt: ${appointments.length}</span>
            <span class="app-meta">Yönetim Yorumu: durum panosu, günlük kapasite ve takip önceliğini hızlı okumak için hazırlanır.</span>
        </div>
    `;
}

function updateDataQualityBoard(appointments) {
    const board = document.getElementById("dataQualityBoard");
    if (!board) return;

    if (!appointments.length) {
        board.innerHTML = "Veri kalite özeti için kayıt bulunmuyor.";
        return;
    }

    const completeRecords = appointments.filter(app =>
        app.service?.name && app.employee?.name && app.branch?.name && app.startTimeUtc && app.endTimeUtc
    ).length;
    const cancelled = appointments.filter(app => app.status === "Cancelled").length;
    const completeness = Math.round((completeRecords / appointments.length) * 100);

    board.innerHTML = `
        <div class="app-info">
            <span class="app-service">Veri Kalite ve Denetim Özeti</span>
            <span class="app-meta">Tam kayıt oranı: %${completeness} | Denetlenen kayıt: ${appointments.length}</span>
            <span class="app-meta">Durum izlenebilirliği: ${cancelled} iptal kaydı geçmişte korunuyor.</span>
            <span class="app-meta">Zorunlu alanlar: hizmet, uzman, şube, başlangıç ve bitiş saati kontrol edilir.</span>
            <span class="app-meta">Profesyonel kullanım: raporlar CSV/JSON olarak dışa aktarılıp operasyon arşivine alınabilir.</span>
        </div>
    `;
}

function buildDailyAgenda() {
    const activeAppointments = sortAppointments(appointmentCache)
        .filter(app => app.status !== "Cancelled")
        .slice(0, 8);

    if (!activeAppointments.length) return "";

    return [
        "AppointmentCore Günlük Ajanda",
        `Oluşturulma zamanı: ${new Date().toLocaleString("tr-TR")}`,
        ...activeAppointments.map(app => {
            const startDate = new Date(app.startTimeUtc);
            return `#${app.id} | ${formatTime(startDate)} | ${app.service?.name || "Hizmet"} | ${app.employee?.name || "Uzman"} | ${app.branch?.name || "Şube"}`;
        })
    ].join("\n");
}

function updateDailyAgendaBoard(appointments) {
    const board = document.getElementById("dailyAgendaBoard");
    if (!board) return;

    const activeAppointments = sortAppointments(appointments)
        .filter(app => app.status !== "Cancelled")
        .slice(0, 3);

    if (!activeAppointments.length) {
        board.innerHTML = "Günlük ajanda için aktif randevu bulunmuyor.";
        return;
    }

    board.innerHTML = `
        <div class="app-info">
            <span class="app-service">Günlük Ajanda Öncelikleri</span>
            ${activeAppointments.map(app => {
                const startDate = new Date(app.startTimeUtc);
                return `<span class="app-meta">#${app.id} | ${formatTime(startDate)} | ${escapeHtml(app.service?.name || "Hizmet")} | ${escapeHtml(app.employee?.name || "Uzman")}</span>`;
            }).join("")}
            <span class="app-meta">Not: Ajanda, iptal edilmemiş en kritik kayıtları hızlı operasyon takibi için öne çıkarır.</span>
        </div>
    `;
}

function updateRiskActionBoard(appointments) {
    const board = document.getElementById("riskActionBoard");
    if (!board) return;

    if (!appointments.length) {
        board.innerHTML = "Risk ve aksiyon özeti için kayıt bulunmuyor.";
        return;
    }

    const now = new Date();
    const upcoming = appointments.filter(app => app.status !== "Cancelled" && new Date(app.startTimeUtc) >= now);
    const cancelled = appointments.filter(app => app.status === "Cancelled");
    const pending = appointments.filter(app => app.status === "Pending");
    const cancellationRate = Math.round((cancelled.length / appointments.length) * 100);
    const riskLevel = cancellationRate >= 35 || pending.length >= 3
        ? "Yüksek takip"
        : cancellationRate >= 15 || pending.length
            ? "Orta takip"
            : "Düşük risk";
    const actionText = pending.length
        ? "Onay bekleyen kayıtlar için müşteri bilgilendirmesi önerilir."
        : upcoming.length
            ? "Yaklaşan randevular için hatırlatma metni paylaşılabilir."
            : "Aktif operasyon için yeni randevu akışı takip edilebilir.";

    board.innerHTML = `
        <div class="app-info">
            <span class="app-service">Risk ve Aksiyon Özeti</span>
            <span class="app-meta">Risk seviyesi: ${riskLevel} | İptal oranı: %${cancellationRate} | Onay bekleyen: ${pending.length}</span>
            <span class="app-meta">Yaklaşan aktif kayıt: ${upcoming.length} | İptal geçmişi: ${cancelled.length}</span>
            <span class="app-meta">Önerilen aksiyon: ${actionText}</span>
            <span class="app-meta">Profesyonel kullanım: bu özet günlük operasyon toplantısı veya müşteri takip listesi için okunabilir.</span>
        </div>
    `;
}

function buildExecutiveDecisionNote() {
    const appointments = sortAppointments(getFilteredAppointments());
    if (!appointments.length) return "";

    const active = appointments.filter(app => app.status !== "Cancelled");
    const pending = appointments.filter(app => app.status === "Pending");
    const cancelled = appointments.filter(app => app.status === "Cancelled");
    const totalValue = active.reduce((sum, app) => sum + Number(app.price ?? app.service?.price ?? 0), 0);
    const totalMinutes = active.reduce((sum, app) => sum + Number(app.service?.durationMinutes || 0), 0);
    const cancellationRate = Math.round((cancelled.length / appointments.length) * 100);
    const recommendation = pending.length
        ? "Öncelik: onay bekleyen kayıtlar için müşteri iletişimi."
        : cancellationRate >= 20
            ? "Öncelik: iptal nedenleri takip edilmeli."
            : "Öncelik: mevcut kapasite korunarak yeni rezervasyon akışı desteklenmeli.";

    return [
        "AppointmentCore Yönetici Karar Notu",
        `Rapor zamanı: ${new Date().toLocaleString("tr-TR")}`,
        `Kayıt: ${appointments.length} | Aktif: ${active.length} | İptal oranı: %${cancellationRate}`,
        `Planlanan değer: ${formatCurrency(totalValue)} | Operasyon süresi: ${formatDuration(totalMinutes)}`,
        recommendation,
        "Not: Bu karar notu mevcut filtre ve arama kriterlerine göre oluşturulmuştur."
    ].join("\n");
}

function updateExecutiveDecisionBoard(appointments) {
    const board = document.getElementById("executiveDecisionBoard");
    if (!board) return;

    const note = buildExecutiveDecisionNote();
    if (!appointments.length || !note) {
        board.innerHTML = "Yönetici karar notu için kayıt bulunmuyor.";
        return;
    }

    const lines = note.split("\n").slice(1);
    board.innerHTML = `
        <div class="app-info">
            <span class="app-service">Yönetici Karar Notu</span>
            ${lines.map(line => `<span class="app-meta">${escapeHtml(line)}</span>`).join("")}
        </div>
    `;
}

async function copyExecutiveDecisionNote() {
    const note = buildExecutiveDecisionNote();
    if (!note) {
        showToast("Kopyalanacak yönetici notu bulunamadı.", "error");
        return;
    }

    try {
        await navigator.clipboard.writeText(note);
        showToast("Yönetici karar notu panoya kopyalandı.", "success");
    } catch (err) {
        showToast("Yönetici karar notu kopyalanamadı.", "error");
    }
}

async function copyDailyAgenda() {
    const agenda = buildDailyAgenda();
    if (!agenda) {
        showToast("Kopyalanacak günlük ajanda bulunamadı.", "error");
        return;
    }

    try {
        await navigator.clipboard.writeText(agenda);
        showToast("Günlük ajanda panoya kopyalandı.", "success");
    } catch (err) {
        showToast("Günlük ajanda kopyalanamadı.", "error");
    }
}

function getFilteredAppointments() {
    const filterValue = document.getElementById("appointmentStatusFilter")?.value || "all";
    const searchValue = (document.getElementById("appointmentSearchInput")?.value || "").trim().toLocaleLowerCase("tr-TR");
    const now = new Date();

    return appointmentCache.filter(app => {
        const matchesStatus = filterValue === "all"
            || (filterValue === "upcoming" && app.status !== "Cancelled" && new Date(app.startTimeUtc) >= now)
            || app.status === filterValue;

        if (!matchesStatus) return false;
        if (!searchValue) return true;

        const searchableText = [
            app.id,
            getStatusText(app.status),
            app.service?.name,
            app.branch?.name,
            app.branch?.address,
            app.employee?.name
        ].join(" ").toLocaleLowerCase("tr-TR");

        return searchableText.includes(searchValue);
    });
}

function sortAppointments(appointments) {
    const sortValue = document.getElementById("appointmentSortSelect")?.value || "date-desc";
    const sorted = [...appointments];

    sorted.sort((a, b) => {
        if (sortValue === "date-asc") {
            return new Date(a.startTimeUtc) - new Date(b.startTimeUtc);
        }
        if (sortValue === "price-desc") {
            return Number(b.price ?? b.service?.price ?? 0) - Number(a.price ?? a.service?.price ?? 0);
        }
        if (sortValue === "service-asc") {
            return String(a.service?.name || "").localeCompare(String(b.service?.name || ""), "tr");
        }
        return new Date(b.startTimeUtc) - new Date(a.startTimeUtc);
    });

    return sorted;
}

function clearAppointmentFilters() {
    const statusFilter = document.getElementById("appointmentStatusFilter");
    const searchInput = document.getElementById("appointmentSearchInput");
    const sortSelect = document.getElementById("appointmentSortSelect");

    if (statusFilter) statusFilter.value = "all";
    if (searchInput) searchInput.value = "";
    if (sortSelect) sortSelect.value = "date-desc";

    renderAppointments();
    showToast("Randevu filtreleri temizlendi.", "success");
}

function csvEscape(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
}

function exportAppointmentsCsv() {
    const appointments = sortAppointments(getFilteredAppointments());
    if (!appointments.length) {
        showToast("Dışa aktarılacak randevu bulunamadı.", "error");
        return;
    }

    const rows = [
        ["Randevu No", "Durum", "Hizmet", "Uzman", "Şube", "Adres", "Başlangıç", "Bitiş", "Süre", "Ücret"]
    ];

    appointments.forEach(app => {
        rows.push([
            `#${app.id}`,
            getStatusText(app.status),
            app.service?.name || "",
            app.employee?.name || "",
            app.branch?.name || "",
            app.branch?.address || "",
            new Date(app.startTimeUtc).toLocaleString("tr-TR"),
            new Date(app.endTimeUtc).toLocaleString("tr-TR"),
            formatDuration(app.service?.durationMinutes),
            formatCurrency(app.price ?? app.service?.price)
        ]);
    });

    const csv = rows.map(row => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "appointmentcore-randevu-raporu.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Randevu raporu indirildi.", "success");
}

function exportAppointmentsJson() {
    const appointments = sortAppointments(getFilteredAppointments());
    if (!appointments.length) {
        showToast("Dışa aktarılacak randevu bulunamadı.", "error");
        return;
    }

    const payload = {
        exportedAt: new Date().toISOString(),
        recordCount: appointments.length,
        records: appointments.map(app => ({
            appointmentNo: app.id,
            status: getStatusText(app.status),
            service: app.service?.name || null,
            employee: app.employee?.name || null,
            branch: app.branch?.name || null,
            address: app.branch?.address || null,
            startTime: app.startTimeUtc,
            endTime: app.endTimeUtc,
            durationMinutes: app.service?.durationMinutes || null,
            price: Number(app.price ?? app.service?.price ?? 0)
        }))
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "appointmentcore-randevu-raporu.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("JSON randevu raporu indirildi.", "success");
}

function buildPortfolioSummary() {
    const appointments = sortAppointments(getFilteredAppointments());
    const activeAppointments = appointments.filter(app => app.status !== "Cancelled");
    const totalValue = activeAppointments.reduce((total, app) => total + Number(app.price ?? app.service?.price ?? 0), 0);
    const totalMinutes = activeAppointments.reduce((total, app) => total + Number(app.service?.durationMinutes || 0), 0);

    return [
        "AppointmentCore Randevu Portföy Özeti",
        `Rapor zamanı: ${new Date().toLocaleString("tr-TR")}`,
        `Listelenen kayıt: ${appointments.length}`,
        `Aktif kayıt: ${activeAppointments.length}`,
        `Planlanan hizmet değeri: ${formatCurrency(totalValue)}`,
        `Planlanan operasyon süresi: ${formatDuration(totalMinutes)}`,
        "Not: Bu özet mevcut filtre ve arama kriterlerine göre oluşturulmuştur."
    ].join("\n");
}

async function copyPortfolioSummary() {
    if (!getFilteredAppointments().length) {
        showToast("Kopyalanacak rapor özeti bulunamadı.", "error");
        return;
    }

    try {
        await navigator.clipboard.writeText(buildPortfolioSummary());
        showToast("Rapor özeti panoya kopyalandı.", "success");
    } catch (err) {
        showToast("Rapor özeti kopyalanamadı.", "error");
    }
}

function buildReminderMessage(app) {
    const startDate = new Date(app.startTimeUtc);
    const endDate = new Date(app.endTimeUtc);
    return [
        `Merhaba, AppointmentCore randevu hatırlatmanız:`,
        `Hizmet: ${app.service?.name || "Hizmet bilgisi yok"}`,
        `Şube: ${app.branch?.name || "Şube bilgisi yok"} - ${app.branch?.address || "Adres bilgisi yok"}`,
        `Uzman: ${app.employee?.name || "Uzman bilgisi yok"}`,
        `Tarih/Saat: ${startDate.toLocaleDateString("tr-TR")} ${formatTime(startDate)} - ${formatTime(endDate)}`,
        `Süre: ${formatDuration(app.service?.durationMinutes)} | Ücret: ${formatCurrency(app.price ?? app.service?.price)}`,
        `Randevudan 10 dakika önce şubede olmanızı rica ederiz.`
    ].join("\n");
}

async function copyReminderMessage(id) {
    const appointment = appointmentCache.find(app => app.id === id);
    if (!appointment) return;

    try {
        await navigator.clipboard.writeText(buildReminderMessage(appointment));
        showToast("Hatırlatma metni panoya kopyalandı.", "success");
    } catch (err) {
        showToast("Hatırlatma metni kopyalanamadı.", "error");
    }
}

function printAppointmentsReport() {
    const appointments = sortAppointments(getFilteredAppointments());
    if (!appointments.length) {
        showToast("Yazdırılacak randevu bulunamadı.", "error");
        return;
    }

    const rows = appointments.map(app => `
        <tr>
            <td>#${app.id}</td>
            <td>${escapeHtml(getStatusText(app.status))}</td>
            <td>${escapeHtml(app.service?.name || "")}</td>
            <td>${escapeHtml(app.employee?.name || "")}</td>
            <td>${escapeHtml(app.branch?.name || "")}</td>
            <td>${new Date(app.startTimeUtc).toLocaleString("tr-TR")}</td>
            <td>${escapeHtml(formatCurrency(app.price ?? app.service?.price))}</td>
        </tr>
    `).join("");

    const reportWindow = window.open("", "_blank");
    if (!reportWindow) {
        showToast("Rapor penceresi açılamadı.", "error");
        return;
    }

    reportWindow.document.write(`
        <!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <title>AppointmentCore Randevu Raporu</title>
            <style>
                body { font-family: Arial, sans-serif; color: #111827; padding: 24px; }
                h1 { font-size: 22px; margin-bottom: 6px; }
                p { color: #4b5563; margin-top: 0; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
                th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
                th { background: #f3f4f6; }
            </style>
        </head>
        <body>
            <h1>AppointmentCore Randevu Raporu</h1>
            <p>Oluşturulma zamanı: ${new Date().toLocaleString("tr-TR")} | Kayıt sayısı: ${appointments.length}</p>
            <table>
                <thead>
                    <tr>
                        <th>No</th>
                        <th>Durum</th>
                        <th>Hizmet</th>
                        <th>Uzman</th>
                        <th>Şube</th>
                        <th>Başlangıç</th>
                        <th>Ücret</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </body>
        </html>
    `);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
    showToast("Yazdırılabilir rapor oluşturuldu.", "success");
}

function buildAppointmentDetails(app) {
    const startDate = new Date(app.startTimeUtc);
    const endDate = new Date(app.endTimeUtc);
    const dateStr = startDate.toLocaleDateString("tr-TR", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const serviceName = app.service?.name || "Hizmet bilgisi yok";
    const branchName = app.branch?.name || "Şube bilgisi yok";
    const branchAddress = app.branch?.address || "Adres bilgisi yok";
    const employeeName = app.employee?.name || "Uzman bilgisi yok";
    const durationText = formatDuration(app.service?.durationMinutes);
    const priceText = formatCurrency(app.price ?? app.service?.price);

    return [
        `AppointmentCore Randevu Detayı`,
        `Randevu No: #${app.id}`,
        `Durum: ${getStatusText(app.status)}`,
        `Hizmet: ${serviceName}`,
        `Uzman: ${employeeName}`,
        `Şube: ${branchName}`,
        `Adres: ${branchAddress}`,
        `Tarih: ${dateStr}`,
        `Saat: ${formatTime(startDate)} - ${formatTime(endDate)}`,
        `Süre: ${durationText}`,
        `Ücret: ${priceText}`,
        `Not: Randevudan 10 dakika önce şubede olmanız önerilir.`
    ].join("\n");
}

async function copyAppointmentDetails(id) {
    const appointment = appointmentCache.find(app => app.id === id);
    if (!appointment) return;

    const details = buildAppointmentDetails(appointment);
    try {
        await navigator.clipboard.writeText(details);
        showToast("Randevu detayı panoya kopyalandı.", "success");
    } catch (err) {
        showToast("Kopyalama izni alınamadı.", "error");
    }
}

function toCalendarTimestamp(dateValue) {
    return new Date(dateValue).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeCalendarText(value) {
    return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\n/g, "\\n");
}

function downloadAppointmentCalendar(id) {
    const appointment = appointmentCache.find(app => app.id === id);
    if (!appointment) return;

    const serviceName = appointment.service?.name || "Randevu";
    const branchName = appointment.branch?.name || "AppointmentCore";
    const details = buildAppointmentDetails(appointment);
    const calendarContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//AppointmentCore//TR",
        "BEGIN:VEVENT",
        `UID:appointment-${appointment.id}@appointmentcore.local`,
        `DTSTAMP:${toCalendarTimestamp(new Date())}`,
        `DTSTART:${toCalendarTimestamp(appointment.startTimeUtc)}`,
        `DTEND:${toCalendarTimestamp(appointment.endTimeUtc)}`,
        `SUMMARY:${escapeCalendarText(serviceName)} - ${escapeCalendarText(branchName)}`,
        `DESCRIPTION:${escapeCalendarText(details)}`,
        `LOCATION:${escapeCalendarText(appointment.branch?.address || branchName)}`,
        "END:VEVENT",
        "END:VCALENDAR"
    ].join("\r\n");

    const blob = new Blob([calendarContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `randevu-${appointment.id}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Takvim dosyası indirildi.", "success");
}



// Authenticate user
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;

    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            currentToken = data.token;
            currentUser = data.user;
            localStorage.setItem("token", currentToken);
            localStorage.setItem("user", JSON.stringify(currentUser));
            
            showToast("Başarıyla giriş yapıldı!", "success");
            showDashboard();
        } else {
            showToast(data.error || "Giriş başarısız.", "error");
        }
    } catch (err) {
        showToast("Sunucuya bağlanılamadı. API açık mı?", "error");
    }
}

// Register user
async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById("registerName").value;
    const email = document.getElementById("registerEmail").value;
    const password = document.getElementById("registerPassword").value;
    const branchId = document.getElementById("registerBranch").value;

    const payload = {
        name,
        email,
        password,
        branchId: branchId ? parseInt(branchId) : null
    };

    try {
        const response = await fetch(`${API_BASE}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            currentToken = data.token;
            currentUser = data.user;
            localStorage.setItem("token", currentToken);
            localStorage.setItem("user", JSON.stringify(currentUser));
            
            showToast("Hesabınız başarıyla oluşturuldu!", "success");
            showDashboard();
        } else {
            showToast(data.error || "Kayıt başarısız.", "error");
        }
    } catch (err) {
        showToast("Sunucuya bağlanılamadı. API açık mı?", "error");
    }
}

function logout(showNotification = true) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    currentUser = null;
    currentToken = null;
    if (showNotification) showToast("Çıkış yapıldı.", "success");
    showLogin();
}

function handleExpiredSession(response) {
    if (response.status !== 401 || !currentToken) return false;
    logout(false);
    showToast("Oturum süreniz doldu. Lütfen yeniden giriş yapın.", "error");
    return true;
}

// Populate Branch Select Dropdown
async function loadBranches() {
    try {
        const response = await fetch(`${API_BASE}/branch`);
        const branches = await response.json();
        branchCache = branches;

        // 1. Populate Dashboard Select
        const branchSelect = document.getElementById("branchSelect");
        if (branchSelect) {
            branchSelect.innerHTML = "";
            branches.forEach(b => {
                const option = document.createElement("option");
                option.value = b.id;
                option.textContent = `${b.name} (${b.timezone})`;
                branchSelect.appendChild(option);
            });

            // Set default selected branch based on user branch if applicable
            if (currentUser && currentUser.branchId) {
                branchSelect.value = currentUser.branchId;
            }
        }

        // 2. Populate Registration Select
        const registerBranch = document.getElementById("registerBranch");
        if (registerBranch) {
            registerBranch.innerHTML = "";
            branches.forEach(b => {
                const option = document.createElement("option");
                option.value = b.id;
                option.textContent = `${b.name} (${b.timezone})`;
                registerBranch.appendChild(option);
            });
        }

        if (currentUser) {
            onBranchChange();
        }
    } catch (err) {
        showToast("Şubeler yüklenemedi.", "error");
    }
}

// On Branch Change, load services and staff members
async function onBranchChange() {
    const branchId = document.getElementById("branchSelect").value;
    if (!branchId) return;

    try {
        // 1. Load Staff members
        const staffRes = await fetch(`${API_BASE}/branch/${branchId}/staff`);
        const staff = await staffRes.json();
        staffCache = staff;
        
        const employeeSelect = document.getElementById("employeeSelect");
        employeeSelect.innerHTML = "";
        staff.forEach(s => {
            const option = document.createElement("option");
            option.value = s.id;
            option.textContent = s.name;
            employeeSelect.appendChild(option);
        });

        // 2. Load Services
        const serviceRes = await fetch(`${API_BASE}/branch/${branchId}/services`);
        const services = await serviceRes.json();
        serviceCache = services;
        
        const serviceSelect = document.getElementById("serviceSelect");
        serviceSelect.innerHTML = "";
        services.forEach(s => {
            const option = document.createElement("option");
            option.value = s.id;
            option.textContent = `${s.name} (${s.durationMinutes} dk) - ${s.price} TL`;
            serviceSelect.appendChild(option);
        });

        await loadSlots();
        updateBookingSummary();
        updateServiceProfile();
        updateQualityChecklist();
        updateServicePolicy();
        updateBookingBriefing();
        updateServiceLevelPanel();
        updateDecisionSupportPanel();
        updateCustomerConsentPanel();
    } catch (err) {
        showToast("Şube detayları yüklenemedi.", "error");
    }
}

// Load available slots
async function loadSlots() {
    selectedSlot = null;
    availableSlots = [];
    document.getElementById("bookBtn").disabled = true;
    const earliestSlotBtn = document.getElementById("earliestSlotBtn");
    if (earliestSlotBtn) earliestSlotBtn.disabled = true;
    updateBookingSummary();
    updateServiceProfile();
    updateQualityChecklist();
    updateServicePolicy();
    updateBookingBriefing();
    updateServiceLevelPanel();
    updateDecisionSupportPanel();
    updateCustomerConsentPanel();

    const branchId = document.getElementById("branchSelect").value;
    const employeeId = document.getElementById("employeeSelect").value;
    const serviceId = document.getElementById("serviceSelect").value;
    const date = document.getElementById("dateInput").value;

    if (!branchId || !employeeId || !serviceId || !date) {
        return;
    }

    const grid = document.getElementById("slotsGrid");
    grid.innerHTML = '<div class="no-slots">Slotlar hesaplanıyor...</div>';

    try {
        const response = await fetch(`${API_BASE}/branch/${branchId}/employees/${employeeId}/slots?serviceId=${serviceId}&date=${date}`);
        const slots = await response.json();
        if (!response.ok || !Array.isArray(slots)) {
            throw new Error(slots.error || "Slotlar yüklenemedi.");
        }
        availableSlots = slots;

        grid.innerHTML = "";

        if (slots.length === 0) {
            grid.innerHTML = '<div class="no-slots">Bugün için uygun çalışma saati veya boş randevu slotu bulunmamaktadır.</div>';
            updateBookingSummary();
            updateServiceProfile();
            updateQualityChecklist();
            updateServicePolicy();
            updateBookingBriefing();
            updateServiceLevelPanel();
            updateDecisionSupportPanel();
            updateCustomerConsentPanel();
            return;
        }

        if (earliestSlotBtn) earliestSlotBtn.disabled = false;
        updateServiceProfile();
        updateQualityChecklist();
        updateServicePolicy();
        updateBookingBriefing();
        updateServiceLevelPanel();
        updateDecisionSupportPanel();
        updateCustomerConsentPanel();

        slots.forEach(slotUtc => {
            const localTime = new Date(slotUtc);
            const hours = String(localTime.getHours()).padStart(2, '0');
            const minutes = String(localTime.getMinutes()).padStart(2, '0');
            
            const pill = document.createElement("div");
            pill.className = "slot-pill";
            pill.innerHTML = `
                <span class="slot-time">${hours}:${minutes}</span>
            `;
            
            pill.addEventListener("click", () => {
                document.querySelectorAll(".slot-pill").forEach(p => p.classList.remove("selected"));
                pill.classList.add("selected");
                selectedSlot = slotUtc;
                document.getElementById("bookBtn").disabled = false;
                updateBookingSummary();
                updateQualityChecklist();
                updateServicePolicy();
                updateBookingBriefing();
                updateServiceLevelPanel();
                updateDecisionSupportPanel();
                updateCustomerConsentPanel();
            });

            grid.appendChild(pill);
        });

    } catch (err) {
        grid.innerHTML = '<div class="no-slots">Hata oluştu. Slotlar yüklenemedi.</div>';
        updateServiceProfile();
        updateQualityChecklist();
        updateServicePolicy();
        updateBookingBriefing();
        updateServiceLevelPanel();
        updateDecisionSupportPanel();
        updateCustomerConsentPanel();
    }
}

function selectEarliestSlot() {
    if (!availableSlots.length) return;

    const firstSlot = availableSlots[0];
    const slotPills = document.querySelectorAll(".slot-pill");
    slotPills.forEach(pill => pill.classList.remove("selected"));

    if (slotPills.length) {
        slotPills[0].classList.add("selected");
    }

    selectedSlot = firstSlot;
    document.getElementById("bookBtn").disabled = false;
    updateBookingSummary();
    updateQualityChecklist();
    updateServicePolicy();
    updateBookingBriefing();
    updateServiceLevelPanel();
    updateDecisionSupportPanel();
    updateCustomerConsentPanel();
    showToast("En erken uygun saat seçildi.", "success");
}

async function findEarliestAvailability() {
    const branchId = document.getElementById("branchSelect").value;
    const serviceId = document.getElementById("serviceSelect").value;
    const fromDate = document.getElementById("dateInput").value;
    const button = document.getElementById("findEarliestBtn");
    const buttonLabel = button?.querySelector("span");

    if (!branchId || !serviceId || !fromDate) {
        showToast("Önce şube, hizmet ve başlangıç tarihi seçin.", "error");
        return;
    }

    if (button) button.disabled = true;
    if (buttonLabel) buttonLabel.textContent = "Takvimler taranıyor...";

    try {
        const response = await fetch(
            `${API_BASE}/branch/${branchId}/earliest-slot?serviceId=${serviceId}&fromDate=${fromDate}&days=14`
        );
        const result = await response.json();
        if (!response.ok) {
            showToast(result.error || "Uygun randevu bulunamadı.", "error");
            return;
        }

        document.getElementById("employeeSelect").value = String(result.employeeId);
        document.getElementById("dateInput").value = result.date;
        await loadSlots();

        const slotIndex = availableSlots.indexOf(result.slotUtc);
        const pills = document.querySelectorAll(".slot-pill");
        if (slotIndex < 0 || !pills[slotIndex]) {
            showToast("Bulunan saat güncellendi; lütfen listeden bir saat seçin.", "error");
            return;
        }

        pills[slotIndex].click();
        showToast(`En yakın saat bulundu: ${result.employeeName}, ${getDateLabel(result.date)} ${formatTime(new Date(result.slotUtc))}`, "success");
    } catch (err) {
        showToast("En yakın randevu aranırken bağlantı hatası oluştu.", "error");
    } finally {
        if (button) button.disabled = false;
        if (buttonLabel) buttonLabel.textContent = "Uzmanlar Arasında En Yakın Saati Bul";
    }
}

// Reserve selected slot
async function bookSelectedSlot() {
    if (!selectedSlot) return;

    const employeeId = document.getElementById("employeeSelect").value;
    const serviceId = document.getElementById("serviceSelect").value;

    const payload = {
        employeeId: parseInt(employeeId),
        serviceId: parseInt(serviceId),
        startTimeUtc: selectedSlot
    };

    try {
        const isRescheduling = Boolean(reschedulingAppointmentId);
        const response = await fetch(
            isRescheduling
                ? `${API_BASE}/appointment/${reschedulingAppointmentId}/reschedule`
                : `${API_BASE}/appointment`, {
            method: isRescheduling ? "PUT" : "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${currentToken}`
            },
            body: JSON.stringify(isRescheduling ? { startTimeUtc: selectedSlot } : payload)
        });

        const data = await response.json();

        if (handleExpiredSession(response)) return;

        if (response.ok) {
            showToast(isRescheduling ? "Randevu başarıyla yeniden planlandı!" : "Randevunuz başarıyla oluşturuldu!", "success");
            reschedulingAppointmentId = null;
            const buttonLabel = document.querySelector("#bookBtn span");
            if (buttonLabel) buttonLabel.textContent = "Seçili Saati Rezerve Et";
            if (Number(currentUser?.role) !== 3) {
                const bookingPanel = document.getElementById("bookingPanel");
                if (bookingPanel) bookingPanel.style.display = "none";
            }
            loadSlots();
            loadMyAppointments();
        } else {
            showToast(data.error || "Randevu kaydı başarısız.", "error");
        }
    } catch (err) {
        showToast("Randevu oluşturulurken bağlantı hatası oluştu.", "error");
    }
}

// Get user appointments dynamically
async function loadMyAppointments() {
    const list = document.getElementById("myAppointmentsList");
    if (!list) return;

    try {
        const response = await fetch(`${API_BASE}/appointment/my-appointments`, {
            headers: { "Authorization": `Bearer ${currentToken}` }
        });
        const appointments = await response.json();
        if (handleExpiredSession(response)) return;
        appointmentCache = appointments;

        renderAppointments();
    } catch (err) {
        list.innerHTML = '<div class="no-slots">Randevular yüklenemedi.</div>';
    }
}

function renderAppointments() {
    const list = document.getElementById("myAppointmentsList");
    if (!list) return;

    updateAppointmentInsights(appointmentCache);
    updateAppointmentStatusBoard(appointmentCache);
    updateDataQualityBoard(appointmentCache);
    updateDailyAgendaBoard(appointmentCache);
    updateRiskActionBoard(appointmentCache);
    updateExecutiveDecisionBoard(appointmentCache);
    list.innerHTML = "";

    if (appointmentCache.length === 0) {
        list.innerHTML = '<div class="no-slots">Aktif bir randevunuz bulunmamaktadır.</div>';
        return;
    }

    const filteredAppointments = sortAppointments(getFilteredAppointments());

    if (filteredAppointments.length === 0) {
        list.innerHTML = '<div class="no-slots">Seçili filtreye uygun randevu bulunamadı.</div>';
        return;
    }

    filteredAppointments.forEach(app => {
        const startDate = new Date(app.startTimeUtc);
        const endDate = new Date(app.endTimeUtc);
        const dateStr = startDate.toLocaleDateString("tr-TR", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const startTimeStr = formatTime(startDate);
        const endTimeStr = formatTime(endDate);
        const serviceName = escapeHtml(app.service?.name || "Hizmet bilgisi yok");
        const branchName = escapeHtml(app.branch?.name || "Şube bilgisi yok");
        const branchAddress = app.branch?.address ? ` - ${escapeHtml(app.branch.address)}` : "";
        const employeeName = escapeHtml(app.employee?.name || "Uzman bilgisi yok");
        const statusText = getStatusText(app.status);
        const durationText = formatDuration(app.service?.durationMinutes);
        const priceText = formatCurrency(app.price ?? app.service?.price);
        
        const item = document.createElement("div");
        item.className = "appointment-item";
        
        const isCancelled = app.status === "Cancelled";
        const statusLabel = isCancelled 
            ? '<span style="color: var(--error-color); font-size: 0.75rem; font-weight: 700; margin-left: 0.5rem;">[İPTAL EDİLDİ]</span>' 
            : '';

        item.innerHTML = `
            <div class="app-info">
                <span class="app-service">${serviceName} ${statusLabel}</span>
                <span class="app-meta">Randevu No: #${app.id} | Durum: ${statusText}</span>
                <span class="app-meta">Şube: ${branchName}${branchAddress}</span>
                <span class="app-meta">Uzman: ${employeeName} | Hizmet Süresi: ${durationText}</span>
                <span class="app-meta" style="color: var(--text-muted);">${dateStr}</span>
                <span class="app-time">Saat: ${startTimeStr} - ${endTimeStr} | Ücret: ${priceText}</span>
                <span class="app-meta">Not: İşlemlerin zamanında başlayabilmesi için randevudan 10 dakika önce şubede olmanız önerilir.</span>
            </div>
            <div>
                <div class="app-info" style="min-width: 120px;">
                    <button class="btn btn-outline btn-cancel-sm" onclick="copyAppointmentDetails(${app.id})">Kopyala</button>
                    <button class="btn btn-outline btn-cancel-sm" onclick="copyReminderMessage(${app.id})">Hatırlatma</button>
                    ${!isCancelled ? `<button class="btn btn-outline btn-cancel-sm" onclick="downloadAppointmentCalendar(${app.id})">Takvime Ekle</button>` : ''}
                    ${!isCancelled && startDate > new Date() ? `<button class="btn btn-outline btn-cancel-sm" onclick="startReschedule(${app.id})">Yeniden Planla</button>` : ''}
                </div>
                ${!isCancelled ? `<button class="btn btn-danger btn-cancel-sm" onclick="cancelAppointment(${app.id})">İptal Et</button>` : ''}
            </div>
        `;
        list.appendChild(item);
    });
}

async function startReschedule(id) {
    const appointment = appointmentCache.find(app => app.id === id);
    if (!appointment || appointment.status === "Cancelled") return;

    reschedulingAppointmentId = id;
    const bookingPanel = document.getElementById("bookingPanel");
    if (bookingPanel) bookingPanel.style.display = "";
    const branchSelect = document.getElementById("branchSelect");
    branchSelect.value = String(appointment.branchId);
    await onBranchChange();

    document.getElementById("employeeSelect").value = String(appointment.employeeId);
    document.getElementById("serviceSelect").value = String(appointment.serviceId);

    const appointmentDate = new Date(appointment.startTimeUtc);
    const year = appointmentDate.getFullYear();
    const month = String(appointmentDate.getMonth() + 1).padStart(2, "0");
    const day = String(appointmentDate.getDate()).padStart(2, "0");
    document.getElementById("dateInput").value = `${year}-${month}-${day}`;
    await loadSlots();

    const buttonLabel = document.querySelector("#bookBtn span");
    if (buttonLabel) buttonLabel.textContent = `Randevu #${id} İçin Yeni Saati Kaydet`;
    document.querySelector(".dashboard-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Yeni tarihi ve saati seçerek randevuyu güncelleyebilirsiniz.", "success");
}

// Cancel booking and refresh UI dynamically
async function cancelAppointment(id) {
    if (!confirm("Bu randevuyu iptal etmek istediğinize emin misiniz?")) return;

    try {
        const response = await fetch(`${API_BASE}/appointment/${id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${currentToken}` }
        });

        const data = await response.json();

        if (handleExpiredSession(response)) return;

        if (response.ok) {
            showToast("Randevu başarıyla iptal edildi.", "success");
            loadSlots();
            loadMyAppointments();
        } else {
            showToast(data.error || "Randevu iptal edilemedi.", "error");
        }
    } catch (err) {
        showToast("Bağlantı hatası oluştu.", "error");
    }
}



// Notification system
function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    const msg = document.getElementById("toastMessage");
    
    toast.className = `toast ${type}`;
    msg.textContent = message;
    
    toast.style.display = "block";
    
    setTimeout(() => {
        toast.style.display = "none";
    }, 4500);
}

window.switchAuthTab = switchAuthTab;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.logout = logout;
window.onBranchChange = onBranchChange;
window.loadSlots = loadSlots;
window.setDateShortcut = setDateShortcut;
window.selectEarliestSlot = selectEarliestSlot;
window.findEarliestAvailability = findEarliestAvailability;
window.bookSelectedSlot = bookSelectedSlot;
window.renderAppointments = renderAppointments;
window.exportAppointmentsCsv = exportAppointmentsCsv;
window.exportAppointmentsJson = exportAppointmentsJson;

// --- New UI Features ---

function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    if (input.type === "password") {
        input.type = "text";
    } else {
        input.type = "password";
    }
}

function openProfileModal() {
    if (!currentUser) return;
    document.getElementById("profileName").value = currentUser.name || "";
    document.getElementById("profileEmail").value = currentUser.email || "";
    document.getElementById("currentPassword").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("profileModal").style.display = "flex";
}

function closeProfileModal() {
    document.getElementById("profileModal").style.display = "none";
}

async function saveProfile() {
    const newName = document.getElementById("profileName").value.trim();
    const newEmail = document.getElementById("profileEmail").value.trim();
    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    
    if (!newName || !newEmail) {
        showToast("Lütfen tüm alanları doldurun.", "error");
        return;
    }
    if ((currentPassword && !newPassword) || (!currentPassword && newPassword)) {
        showToast("Şifre değiştirmek için iki şifre alanını da doldurun.", "error");
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/auth/profile`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${currentToken}`
            },
            body: JSON.stringify({ name: newName, email: newEmail })
        });
        const data = await response.json();

        if (handleExpiredSession(response)) return;

        if (!response.ok) {
            showToast(data.error || "Profil güncellenemedi.", "error");
            return;
        }

        currentUser = data.user;
        localStorage.setItem("user", JSON.stringify(currentUser));
        document.getElementById("userNameDisplay").textContent = currentUser.name;

        if (currentPassword && newPassword) {
            const passwordResponse = await fetch(`${API_BASE}/auth/password`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${currentToken}`
                },
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const passwordData = await passwordResponse.json();
            if (handleExpiredSession(passwordResponse)) return;
            if (!passwordResponse.ok) {
                showToast(passwordData.error || "Şifre güncellenemedi.", "error");
                return;
            }
        }

        closeProfileModal();
        showToast(currentPassword ? "Profil ve şifre başarıyla güncellendi." : "Profiliniz başarıyla güncellendi.", "success");
    } catch (err) {
        showToast("Profil güncellenirken bağlantı hatası oluştu.", "error");
    }
}

window.togglePasswordVisibility = togglePasswordVisibility;
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
window.saveProfile = saveProfile;
window.clearAppointmentFilters = clearAppointmentFilters;
window.printAppointmentsReport = printAppointmentsReport;
window.copyPortfolioSummary = copyPortfolioSummary;
window.copyBookingBriefing = copyBookingBriefing;
window.copyCustomerConsentText = copyCustomerConsentText;
window.copyDailyAgenda = copyDailyAgenda;
window.copyExecutiveDecisionNote = copyExecutiveDecisionNote;
window.cancelAppointment = cancelAppointment;
window.startReschedule = startReschedule;
window.copyAppointmentDetails = copyAppointmentDetails;
window.copyReminderMessage = copyReminderMessage;
window.downloadAppointmentCalendar = downloadAppointmentCalendar;
